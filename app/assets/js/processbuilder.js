const AdmZip                = require('adm-zip')
const child_process         = require('child_process')
const crypto                = require('crypto')
const fs                    = require('fs-extra')
const { LoggerUtil }        = require('helios-core')
const { getMojangOS, isLibraryCompatible, mcVersionAtLeast }  = require('helios-core/common')
const { Type }              = require('helios-distribution-types')
const os                    = require('os')
const path                  = require('path')

const ConfigManager            = require('./configmanager')

const logger = LoggerUtil.getLogger('ProcessBuilder')

const CURRENT_POKEVILL_SERVER_ADDRESS = 'reade.p-e.kr'
const LEGACY_POKEVILL_SERVER_ADDRESSES = ['pokevill.r-e.kr', 'pokevill.mcv.kr']


/**
 * Only forge and fabric are top level mod loaders.
 * 
 * Forge 1.13+ launch logic is similar to fabrics, for now using usingFabricLoader flag to
 * change minor details when needed.
 * 
 * Rewrite of this module may be needed in the future.
 */
class ProcessBuilder {

    constructor(distroServer, vanillaManifest, modManifest, authUser, launcherVersion){
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), distroServer.rawServer.id)
        this.commonDir = ConfigManager.getCommonDirectory()
        this.server = distroServer
        this.vanillaManifest = vanillaManifest
        this.modManifest = modManifest
        this.authUser = authUser
        this.launcherVersion = launcherVersion
        this.forgeModListFile = path.join(this.gameDir, 'forgeMods.list') // 1.13+
        this.fmlDir = path.join(this.gameDir, 'forgeModList.json')
        this.llDir = path.join(this.gameDir, 'liteloaderModList.json')
        this.libPath = path.join(this.commonDir, 'libraries')

        this.usingLiteLoader = false
        this.usingFabricLoader = false
        this.llPath = null
    }
    
    /**
     * Convienence method to run the functions typically used to build a process.
     */
    build(){
        fs.ensureDirSync(this.gameDir)
        this.ensureInitialMinecraftDefaults()
        this.ensureDefaultShaderConfig()
        this.ensureCurrentServerAddress()
        const tempNativePath = path.join(os.tmpdir(), ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'))
        process.throwDeprecation = true
        this.setupLiteLoader()
        logger.info('Using liteloader:', this.usingLiteLoader)
        this.usingFabricLoader = this.server.modules.some(mdl => mdl.rawModule.type === Type.Fabric)
        logger.info('Using fabric loader:', this.usingFabricLoader)
        const modObj = this.resolveModConfiguration(ConfigManager.getModConfiguration(this.server.rawServer.id).mods, this.server.modules)
        
        // Mod list below 1.13
        // Fabric only supports 1.14+
        if(!mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)){
            this.constructJSONModList('forge', modObj.fMods, true)
            if(this.usingLiteLoader){
                this.constructJSONModList('liteloader', modObj.lMods, true)
            }
        }
        
        const uberModArr = modObj.fMods.concat(modObj.lMods)
        let args = this.constructJVMArguments(uberModArr, tempNativePath)

        if(mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)){
            //args = args.concat(this.constructModArguments(modObj.fMods))
            args = args.concat(this.constructModList(modObj.fMods))
        }

        logger.info('Launch Arguments:', args)

        const child = child_process.spawn(ConfigManager.getJavaExecutable(this.server.rawServer.id), args, {
            cwd: this.gameDir,
            detached: ConfigManager.getLaunchDetached()
        })

        if(ConfigManager.getLaunchDetached()){
            child.unref()
        }

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')

        child.stdout.on('data', (data) => {
            data.trim().split('\n').forEach(x => console.log(`\x1b[32m[Minecraft]\x1b[0m ${x}`))
            
        })
        child.stderr.on('data', (data) => {
            data.trim().split('\n').forEach(x => console.log(`\x1b[31m[Minecraft]\x1b[0m ${x}`))
        })
        child.on('close', (code, _signal) => {
            logger.info('Exited with code', code)
            fs.remove(tempNativePath, (err) => {
                if(err){
                    logger.warn('Error while deleting temp dir', err)
                } else {
                    logger.info('Temp dir deleted successfully.')
                }
            })
        })

        return child
    }

    ensureInitialMinecraftDefaults() {
        const markerPath = path.join(this.gameDir, '.pokevill-options-initialized.json')

        if(fs.existsSync(markerPath)) {
            return
        }

        // 이 구현의 의도는 사용자의 설정을 매 실행마다 덮지 않고, 포켓빌 런처 첫 실행 1회에만 기본값을 주입하는 것이다.
        this.copyBundledDefaultFile('options.txt')
        this.copyBundledDefaultFile('servers.dat')
        this.copyBundledDefaultPath(path.join('config', 'iris.properties'))

        fs.writeJsonSync(markerPath, {
            server: this.server.rawServer.id,
            launcherVersion: this.launcherVersion,
            initializedAt: new Date().toISOString()
        }, { spaces: 2 })
        logger.info('Initial Minecraft defaults copied once:', markerPath)
    }

    copyBundledDefaultFile(fileName) {
        this.copyBundledDefaultPath(fileName)
    }

    copyBundledDefaultPath(relativePath) {
        const defaultPath = path.join(__dirname, '..', 'defaults', relativePath)
        const gamePath = path.join(this.gameDir, relativePath)

        if(fs.existsSync(defaultPath)) {
            fs.ensureDirSync(path.dirname(gamePath))
            fs.copyFileSync(defaultPath, gamePath)
            logger.info(`Default ${relativePath} copied:`, gamePath)
        }
    }

    ensureDefaultShaderConfig() {
        const relativePath = path.join('config', 'iris.properties')
        const gamePath = path.join(this.gameDir, relativePath)

        // 이 구현의 의도는 기존 유저가 Iris 설정을 직접 만든 경우 보존하고, 설정 파일이 없는 인스턴스에만 기본 쉐이더를 켜는 것이다.
        if(!fs.existsSync(gamePath)) {
            this.copyBundledDefaultPath(relativePath)
        }
    }

    ensureCurrentServerAddress() {
        const optionsPath = path.join(this.gameDir, 'options.txt')
        const serversPath = path.join(this.gameDir, 'servers.dat')

        // 이 구현의 의도는 기존 유저의 조작키/그래픽 설정은 보존하면서 포켓빌 접속 주소만 새 운영 주소로 되돌리는 것이다.
        this.replaceLegacyServerAddressInTextFile(optionsPath)

        if(!fs.existsSync(serversPath)) {
            this.copyBundledDefaultFile('servers.dat')
        } else {
            this.replaceLegacyServerAddressInBinaryFile(serversPath)
        }
    }

    replaceLegacyServerAddressInTextFile(filePath) {
        if(!fs.existsSync(filePath)) {
            return
        }

        let fileText = fs.readFileSync(filePath, 'UTF-8')
        let changed = false

        for(const legacyAddress of LEGACY_POKEVILL_SERVER_ADDRESSES) {
            if(fileText.includes(legacyAddress)) {
                fileText = fileText.split(legacyAddress).join(CURRENT_POKEVILL_SERVER_ADDRESS)
                changed = true
            }
        }

        if(changed) {
            fs.writeFileSync(filePath, fileText, 'UTF-8')
            logger.info('Pokevill server address migrated in text file:', filePath)
        }
    }

    replaceLegacyServerAddressInBinaryFile(filePath) {
        if(!fs.existsSync(filePath)) {
            return
        }

        let migration

        try {
            migration = this.rewriteLegacyServerAddressInNbtBuffer(fs.readFileSync(filePath))
        } catch(err) {
            logger.warn('Skipping Pokevill server address migration because servers.dat could not be parsed:', err)
            return
        }

        if(migration.changed) {
            fs.writeFileSync(filePath, migration.buffer)
            logger.info('Pokevill server address migrated in binary file:', filePath)
        }
    }

    rewriteLegacyServerAddressInNbtBuffer(fileBuffer) {
        const state = {
            offset: 0,
            chunks: [],
            changed: false
        }

        const tagType = this.readNbtTagType(fileBuffer, state)

        if(tagType === 0) {
            return { buffer: fileBuffer, changed: false }
        }

        this.copyNbtName(fileBuffer, state)
        this.copyOrRewriteNbtPayload(fileBuffer, state, tagType, null)

        if(state.offset !== fileBuffer.length) {
            state.chunks.push(fileBuffer.subarray(state.offset))
        }

        return {
            buffer: state.changed ? Buffer.concat(state.chunks) : fileBuffer,
            changed: state.changed
        }
    }

    readNbtTagType(fileBuffer, state) {
        this.assertNbtReadable(fileBuffer, state, 1)
        const start = state.offset
        const tagType = fileBuffer.readUInt8(state.offset)
        state.offset += 1
        state.chunks.push(fileBuffer.subarray(start, state.offset))
        return tagType
    }

    copyNbtName(fileBuffer, state) {
        this.assertNbtReadable(fileBuffer, state, 2)
        const start = state.offset
        const nameLength = fileBuffer.readUInt16BE(state.offset)
        state.offset += 2
        this.assertNbtReadable(fileBuffer, state, nameLength)
        const nameStart = state.offset
        state.offset += nameLength
        state.chunks.push(fileBuffer.subarray(start, state.offset))
        return fileBuffer.toString('utf8', nameStart, state.offset)
    }

    copyOrRewriteNbtPayload(fileBuffer, state, tagType, tagName) {
        switch(tagType) {
            case 1:
                this.copyNbtBytes(fileBuffer, state, 1)
                break
            case 2:
                this.copyNbtBytes(fileBuffer, state, 2)
                break
            case 3:
            case 5:
                this.copyNbtBytes(fileBuffer, state, 4)
                break
            case 4:
            case 6:
                this.copyNbtBytes(fileBuffer, state, 8)
                break
            case 7:
                this.copyNbtArrayPayload(fileBuffer, state, 1)
                break
            case 8:
                this.copyOrRewriteNbtStringPayload(fileBuffer, state, tagName)
                break
            case 9:
                this.copyOrRewriteNbtListPayload(fileBuffer, state)
                break
            case 10:
                this.copyOrRewriteNbtCompoundPayload(fileBuffer, state)
                break
            case 11:
                this.copyNbtArrayPayload(fileBuffer, state, 4)
                break
            case 12:
                this.copyNbtArrayPayload(fileBuffer, state, 8)
                break
            default:
                throw new Error(`Unsupported NBT tag type ${tagType}`)
        }
    }

    copyOrRewriteNbtStringPayload(fileBuffer, state, tagName) {
        this.assertNbtReadable(fileBuffer, state, 2)
        const start = state.offset
        const stringLength = fileBuffer.readUInt16BE(state.offset)
        state.offset += 2
        this.assertNbtReadable(fileBuffer, state, stringLength)
        const valueStart = state.offset
        state.offset += stringLength
        const value = fileBuffer.toString('utf8', valueStart, state.offset)

        if(tagName === 'ip' && LEGACY_POKEVILL_SERVER_ADDRESSES.includes(value)) {
            const addressBuffer = Buffer.from(CURRENT_POKEVILL_SERVER_ADDRESS, 'utf8')
            const lengthBuffer = Buffer.alloc(2)
            lengthBuffer.writeUInt16BE(addressBuffer.length)
            state.chunks.push(lengthBuffer, addressBuffer)
            state.changed = true
            return
        }

        state.chunks.push(fileBuffer.subarray(start, state.offset))
    }

    copyOrRewriteNbtListPayload(fileBuffer, state) {
        this.assertNbtReadable(fileBuffer, state, 5)
        const start = state.offset
        const elementType = fileBuffer.readUInt8(state.offset)
        state.offset += 1
        const listLength = fileBuffer.readInt32BE(state.offset)
        state.offset += 4
        state.chunks.push(fileBuffer.subarray(start, state.offset))

        for(let i = 0; i < listLength; i++) {
            this.copyOrRewriteNbtPayload(fileBuffer, state, elementType, null)
        }
    }

    copyOrRewriteNbtCompoundPayload(fileBuffer, state) {
        while(true) {
            const tagType = this.readNbtTagType(fileBuffer, state)

            if(tagType === 0) {
                return
            }

            const tagName = this.copyNbtName(fileBuffer, state)
            this.copyOrRewriteNbtPayload(fileBuffer, state, tagType, tagName)
        }
    }

    copyNbtArrayPayload(fileBuffer, state, elementSize) {
        this.assertNbtReadable(fileBuffer, state, 4)
        const start = state.offset
        const arrayLength = fileBuffer.readInt32BE(state.offset)
        state.offset += 4
        this.copyNbtBytes(fileBuffer, state, arrayLength * elementSize, start)
    }

    copyNbtBytes(fileBuffer, state, byteLength, start = state.offset) {
        this.assertNbtReadable(fileBuffer, state, byteLength)
        state.offset += byteLength
        state.chunks.push(fileBuffer.subarray(start, state.offset))
    }

    assertNbtReadable(fileBuffer, state, byteLength) {
        if(byteLength < 0 || state.offset + byteLength > fileBuffer.length) {
            throw new Error('Unexpected end of NBT data')
        }
    }

    ensureDefaultOptions() {
        const defaultOptionsPath = path.join(__dirname, '..', 'defaults', 'options.txt')
        const gameOptionsPath = path.join(this.gameDir, 'options.txt')

        // 인스턴스가 처음 만들어졌을 때만 기본 조작키를 넣는다.
        // 이미 options.txt가 있으면 유저가 게임 안에서 바꾼 키 설정을 존중해서 덮어쓰지 않는다.
        if(fs.existsSync(defaultOptionsPath) && !fs.existsSync(gameOptionsPath)) {
            fs.copyFileSync(defaultOptionsPath, gameOptionsPath)
            logger.info('Default Minecraft options copied:', gameOptionsPath)
        }
    }

    ensureRequiredResourcePacks() {
        const gameOptionsPath = path.join(this.gameDir, 'options.txt')

        if(!fs.existsSync(gameOptionsPath)) {
            return
        }

        let optionsText = fs.readFileSync(gameOptionsPath, 'UTF-8')

        // 런처로 접속할 때마다 포켓빌 리소스팩 두 개가 선택된 상태가 되도록 리소스팩 설정만 고정한다.
        optionsText = this.replaceOrAppendOption(optionsText, 'resourcePacks', 'resourcePacks:["vanilla","mod_resources","file/pokevill.zip","file/build.zip"]')
        optionsText = this.replaceOrAppendOption(optionsText, 'incompatibleResourcePacks', 'incompatibleResourcePacks:[]')

        fs.writeFileSync(gameOptionsPath, optionsText, 'UTF-8')
    }

    replaceOrAppendOption(optionsText, key, line) {
        const optionRegex = new RegExp(`^${key}:.*$`, 'm')

        if(optionRegex.test(optionsText)) {
            return optionsText.replace(optionRegex, line)
        }

        return `${optionsText.trimEnd()}\n${line}\n`
    }

    /**
     * Get the platform specific classpath separator. On windows, this is a semicolon.
     * On Unix, this is a colon.
     * 
     * @returns {string} The classpath separator for the current operating system.
     */
    static getClasspathSeparator() {
        return process.platform === 'win32' ? ';' : ':'
    }

    /**
     * Determine if an optional mod is enabled from its configuration value. If the
     * configuration value is null, the required object will be used to
     * determine if it is enabled.
     * 
     * A mod is enabled if:
     *   * The configuration is not null and one of the following:
     *     * The configuration is a boolean and true.
     *     * The configuration is an object and its 'value' property is true.
     *   * The configuration is null and one of the following:
     *     * The required object is null.
     *     * The required object's 'def' property is null or true.
     * 
     * @param {Object | boolean} modCfg The mod configuration object.
     * @param {Object} required Optional. The required object from the mod's distro declaration.
     * @returns {boolean} True if the mod is enabled, false otherwise.
     */
    static isModEnabled(modCfg, required = null){
        return modCfg != null ? ((typeof modCfg === 'boolean' && modCfg) || (typeof modCfg === 'object' && (typeof modCfg.value !== 'undefined' ? modCfg.value : true))) : required != null ? required.def : true
    }

    /**
     * Function which performs a preliminary scan of the top level
     * mods. If liteloader is present here, we setup the special liteloader
     * launch options. Note that liteloader is only allowed as a top level
     * mod. It must not be declared as a submodule.
     */
    setupLiteLoader(){
        for(let ll of this.server.modules){
            if(ll.rawModule.type === Type.LiteLoader){
                if(!ll.getRequired().value){
                    const modCfg = ConfigManager.getModConfiguration(this.server.rawServer.id).mods
                    if(ProcessBuilder.isModEnabled(modCfg[ll.getVersionlessMavenIdentifier()], ll.getRequired())){
                        if(fs.existsSync(ll.getPath())){
                            this.usingLiteLoader = true
                            this.llPath = ll.getPath()
                        }
                    }
                } else {
                    if(fs.existsSync(ll.getPath())){
                        this.usingLiteLoader = true
                        this.llPath = ll.getPath()
                    }
                }
            }
        }
    }

    /**
     * Resolve an array of all enabled mods. These mods will be constructed into
     * a mod list format and enabled at launch.
     * 
     * @param {Object} modCfg The mod configuration object.
     * @param {Array.<Object>} mdls An array of modules to parse.
     * @returns {{fMods: Array.<Object>, lMods: Array.<Object>}} An object which contains
     * a list of enabled forge mods and litemods.
     */
    resolveModConfiguration(modCfg, mdls){
        let fMods = []
        let lMods = []

        for(let mdl of mdls){
            const type = mdl.rawModule.type
            if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                const o = !mdl.getRequired().value
                const e = ProcessBuilder.isModEnabled(modCfg[mdl.getVersionlessMavenIdentifier()], mdl.getRequired())
                if(!o || (o && e)){
                    if(mdl.subModules.length > 0){
                        const v = this.resolveModConfiguration(modCfg[mdl.getVersionlessMavenIdentifier()].mods, mdl.subModules)
                        fMods = fMods.concat(v.fMods)
                        lMods = lMods.concat(v.lMods)
                        if(type === Type.LiteLoader){
                            continue
                        }
                    }
                    if(type === Type.ForgeMod || type === Type.FabricMod){
                        fMods.push(mdl)
                    } else {
                        lMods.push(mdl)
                    }
                }
            }
        }

        return {
            fMods,
            lMods
        }
    }

    _lteMinorVersion(version) {
        return Number(this.modManifest.id.split('-')[0].split('.')[1]) <= Number(version)
    }

    /**
     * Test to see if this version of forge requires the absolute: prefix
     * on the modListFile repository field.
     */
    _requiresAbsolute(){
        try {
            if(this._lteMinorVersion(9)) {
                return false
            }
            const ver = this.modManifest.id.split('-')[2]
            const pts = ver.split('.')
            const min = [14, 23, 3, 2655]
            for(let i=0; i<pts.length; i++){
                const parsed = Number.parseInt(pts[i])
                if(parsed < min[i]){
                    return false
                } else if(parsed > min[i]){
                    return true
                }
            }
        } catch (_err) {
            // We know old forge versions follow this format.
            // Error must be caused by newer version.
        }
        
        // Equal or errored
        return true
    }

    /**
     * Construct a mod list json object.
     * 
     * @param {'forge' | 'liteloader'} type The mod list type to construct.
     * @param {Array.<Object>} mods An array of mods to add to the mod list.
     * @param {boolean} save Optional. Whether or not we should save the mod list file.
     */
    constructJSONModList(type, mods, save = false){
        const modList = {
            repositoryRoot: ((type === 'forge' && this._requiresAbsolute()) ? 'absolute:' : '') + path.join(this.commonDir, 'modstore')
        }

        const ids = []
        if(type === 'forge'){
            for(let mod of mods){
                ids.push(mod.getExtensionlessMavenIdentifier())
            }
        } else {
            for(let mod of mods){
                ids.push(mod.getMavenIdentifier())
            }
        }
        modList.modRef = ids
        
        if(save){
            const json = JSON.stringify(modList, null, 4)
            fs.writeFileSync(type === 'forge' ? this.fmlDir : this.llDir, json, 'UTF-8')
        }

        return modList
    }

    // /**
    //  * Construct the mod argument list for forge 1.13
    //  * 
    //  * @param {Array.<Object>} mods An array of mods to add to the mod list.
    //  */
    // constructModArguments(mods){
    //     const argStr = mods.map(mod => {
    //         return mod.getExtensionlessMavenIdentifier()
    //     }).join(',')

    //     if(argStr){
    //         return [
    //             '--fml.mavenRoots',
    //             path.join('..', '..', 'common', 'modstore'),
    //             '--fml.mods',
    //             argStr
    //         ]
    //     } else {
    //         return []
    //     }
        
    // }

    /**
     * Construct the mod argument list for forge 1.13 and Fabric
     * 
     * @param {Array.<Object>} mods An array of mods to add to the mod list.
     */
    constructModList(mods) {
        if(this.isNeoForgeModernManifest()) {
            const modsDir = path.join(this.gameDir, 'mods')
            fs.ensureDirSync(modsDir)
            fs.emptyDirSync(modsDir)
            for(const mod of mods) {
                fs.copyFileSync(mod.getPath(), path.join(modsDir, path.basename(mod.getPath())))
            }
            return []
        }

        const writeBuffer = mods.map(mod => {
            return this.usingFabricLoader ? mod.getPath() : mod.getExtensionlessMavenIdentifier()
        }).join('\n')

        if(writeBuffer) {
            fs.writeFileSync(this.forgeModListFile, writeBuffer, 'UTF-8')
            return this.usingFabricLoader ? [
                '--fabric.addMods',
                `@${this.forgeModListFile}`
            ] : [
                '--fml.mavenRoots',
                path.join('..', '..', 'common', 'modstore'),
                '--fml.modLists',
                this.forgeModListFile
            ]
        } else {
            return []
        }

    }

    isNeoForgeModernManifest() {
        if(!this.modManifest || !this.modManifest.id) {
            return false
        }

        const modManifestId = this.modManifest.id.toLowerCase()
        return modManifestId.includes('neoforge') || modManifestId.startsWith('21.')
    }

    _processAutoConnectArg(args){
        if(ConfigManager.getAutoConnect() && this.server.rawServer.autoconnect){
            if(mcVersionAtLeast('1.20', this.server.rawServer.minecraftVersion)){
                args.push('--quickPlayMultiplayer')
                args.push(`${this.server.hostname}:${this.server.port}`)
            } else {
                args.push('--server')
                args.push(this.server.hostname)
                args.push('--port')
                args.push(this.server.port)
            }
        }
    }

    /**
     * Construct the argument array that will be passed to the JVM process.
     * 
     * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
     * @param {string} tempNativePath The path to store the native libraries.
     * @returns {Array.<string>} An array containing the full JVM arguments for this process.
     */
    constructJVMArguments(mods, tempNativePath){
        if(mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)){
            return this._constructJVMArguments113(mods, tempNativePath)
        } else {
            return this._constructJVMArguments112(mods, tempNativePath)
        }
    }

    /**
     * Construct the argument array that will be passed to the JVM process.
     * This function is for 1.12 and below.
     * 
     * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
     * @param {string} tempNativePath The path to store the native libraries.
     * @returns {Array.<string>} An array containing the full JVM arguments for this process.
     */
    _constructJVMArguments112(mods, tempNativePath){

        let args = []

        // Classpath Argument
        args.push('-cp')
        args.push(this.classpathArg(mods, tempNativePath).join(ProcessBuilder.getClasspathSeparator()))

        // Java Arguments
        if(process.platform === 'darwin'){
            args.push('-Xdock:name=Pokevill')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', 'images', 'minecraft.icns'))
        }
        args.push('-Xmx' + ConfigManager.getMaxRAM(this.server.rawServer.id))
        args.push('-Xms' + ConfigManager.getMinRAM(this.server.rawServer.id))
        args = args.concat(ConfigManager.getJVMOptions(this.server.rawServer.id))
        args.push('-Djava.library.path=' + tempNativePath)

        // Main Java Class
        args.push(this.modManifest.mainClass)

        // Forge Arguments
        args = args.concat(this._resolveForgeArgs())

        return args
    }

    /**
     * Construct the argument array that will be passed to the JVM process.
     * This function is for 1.13+
     * 
     * Note: Required Libs https://github.com/MinecraftForge/MinecraftForge/blob/af98088d04186452cb364280340124dfd4766a5c/src/fmllauncher/java/net/minecraftforge/fml/loading/LibraryFinder.java#L82
     * 
     * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
     * @param {string} tempNativePath The path to store the native libraries.
     * @returns {Array.<string>} An array containing the full JVM arguments for this process.
     */
    _constructJVMArguments113(mods, tempNativePath){

        const argDiscovery = /\${*(.*)}/

        // JVM Arguments First
        let args = this.vanillaManifest.arguments.jvm

        // Debug securejarhandler
        // args.push('-Dbsl.debug=true')

        if(this.modManifest.arguments.jvm != null) {
            for(const argStr of this.modManifest.arguments.jvm) {
                let finalArgStr = argStr
                if(finalArgStr.includes('-DignoreList=')) {
                    if(this.modManifest.id && this.modManifest.id.startsWith('21.')) {
                        finalArgStr = finalArgStr.replaceAll('${version_name}.jar', `neoforge-${this.modManifest.id}.jar,neoforge-${this.modManifest.id}-universal.jar,neoforge-${this.modManifest.id}-client.jar`)
                    } else {
                        finalArgStr = finalArgStr.replaceAll('${version_name}', this.modManifest.id)
                    }
                } else {
                    finalArgStr = finalArgStr.replaceAll('${version_name}', this.modManifest.id)
                }

                args.push(finalArgStr
                    .replaceAll('${library_directory}', this.libPath)
                    .replaceAll('${classpath_separator}', ProcessBuilder.getClasspathSeparator())
                )
            }
        }

        //args.push('-Dlog4j.configurationFile=D:\\WesterosCraft\\game\\common\\assets\\log_configs\\client-1.12.xml')

        // Java Arguments
        if(process.platform === 'darwin'){
            args.push('-Xdock:name=Pokevill')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', 'images', 'minecraft.icns'))
        }
        args.push('-Xmx' + ConfigManager.getMaxRAM(this.server.rawServer.id))
        args.push('-Xms' + ConfigManager.getMinRAM(this.server.rawServer.id))
        args = args.concat(ConfigManager.getJVMOptions(this.server.rawServer.id))

        // Main Java Class
        args.push(this.modManifest.mainClass)

        // Vanilla Arguments
        args = args.concat(this.vanillaManifest.arguments.game)

        for(let i=0; i<args.length; i++){
            if(typeof args[i] === 'object' && args[i].rules != null){
                
                let checksum = 0
                for(let rule of args[i].rules){
                    if(rule.os != null){
                        if(rule.os.name === getMojangOS()
                            && (rule.os.version == null || new RegExp(rule.os.version).test(os.release))){
                            if(rule.action === 'allow'){
                                checksum++
                            }
                        } else {
                            if(rule.action === 'disallow'){
                                checksum++
                            }
                        }
                    } else if(rule.features != null){
                        // We don't have many 'features' in the index at the moment.
                        // This should be fine for a while.
                        if(rule.features.has_custom_resolution != null && rule.features.has_custom_resolution === true){
                            if(ConfigManager.getFullscreen()){
                                args[i].value = [
                                    '--fullscreen',
                                    'true'
                                ]
                            }
                            checksum++
                        }
                    }
                }

                // TODO splice not push
                if(checksum === args[i].rules.length){
                    if(typeof args[i].value === 'string'){
                        args[i] = args[i].value
                    } else if(typeof args[i].value === 'object'){
                        //args = args.concat(args[i].value)
                        args.splice(i, 1, ...args[i].value)
                    }

                    // Decrement i to reprocess the resolved value
                    i--
                } else {
                    args[i] = null
                }

            } else if(typeof args[i] === 'string'){
                if(argDiscovery.test(args[i])){
                    const identifier = args[i].match(argDiscovery)[1]
                    let val = null
                    switch(identifier){
                        case 'auth_player_name':
                            val = this.authUser.displayName.trim()
                            break
                        case 'version_name':
                            //val = vanillaManifest.id
                            val = this.server.rawServer.id
                            break
                        case 'game_directory':
                            val = this.gameDir
                            break
                        case 'assets_root':
                            val = path.join(this.commonDir, 'assets')
                            break
                        case 'assets_index_name':
                            val = this.vanillaManifest.assets
                            break
                        case 'auth_uuid':
                            val = this.authUser.uuid.trim()
                            break
                        case 'auth_access_token':
                            val = this.authUser.accessToken
                            break
                        case 'user_type':
                            val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'
                            break
                        case 'version_type':
                            val = this.vanillaManifest.type
                            break
                        case 'resolution_width':
                            val = ConfigManager.getGameWidth()
                            break
                        case 'resolution_height':
                            val = ConfigManager.getGameHeight()
                            break
                        case 'natives_directory':
                            val = args[i].replace(argDiscovery, tempNativePath)
                            break
                        case 'launcher_name':
                            val = args[i].replace(argDiscovery, 'Sample-Launcher')
                            break
                        case 'launcher_version':
                            val = args[i].replace(argDiscovery, this.launcherVersion)
                            break
                        case 'classpath':
                            val = this.classpathArg(mods, tempNativePath).join(ProcessBuilder.getClasspathSeparator())
                            break
                    }
                    if(val != null){
                        args[i] = val
                    }
                }
            }
        }

        // Autoconnect
        this._processAutoConnectArg(args)
        

        // Forge Specific Arguments
        args = args.concat(this.modManifest.arguments.game)

        // Filter null values
        args = args.filter(arg => {
            return arg != null
        })

        return args
    }

    /**
     * Resolve the arguments required by forge.
     * 
     * @returns {Array.<string>} An array containing the arguments required by forge.
     */
    _resolveForgeArgs(){
        const mcArgs = this.modManifest.minecraftArguments.split(' ')
        const argDiscovery = /\${*(.*)}/

        // Replace the declared variables with their proper values.
        for(let i=0; i<mcArgs.length; ++i){
            if(argDiscovery.test(mcArgs[i])){
                const identifier = mcArgs[i].match(argDiscovery)[1]
                let val = null
                switch(identifier){
                    case 'auth_player_name':
                        val = this.authUser.displayName.trim()
                        break
                    case 'version_name':
                        //val = vanillaManifest.id
                        val = this.server.rawServer.id
                        break
                    case 'game_directory':
                        val = this.gameDir
                        break
                    case 'assets_root':
                        val = path.join(this.commonDir, 'assets')
                        break
                    case 'assets_index_name':
                        val = this.vanillaManifest.assets
                        break
                    case 'auth_uuid':
                        val = this.authUser.uuid.trim()
                        break
                    case 'auth_access_token':
                        val = this.authUser.accessToken
                        break
                    case 'user_type':
                        val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'
                        break
                    case 'user_properties': // 1.8.9 and below.
                        val = '{}'
                        break
                    case 'version_type':
                        val = this.vanillaManifest.type
                        break
                }
                if(val != null){
                    mcArgs[i] = val
                }
            }
        }

        // Autoconnect to the selected server.
        this._processAutoConnectArg(mcArgs)

        // Prepare game resolution
        if(ConfigManager.getFullscreen()){
            mcArgs.push('--fullscreen')
            mcArgs.push(true)
        } else {
            mcArgs.push('--width')
            mcArgs.push(ConfigManager.getGameWidth())
            mcArgs.push('--height')
            mcArgs.push(ConfigManager.getGameHeight())
        }
        
        // Mod List File Argument
        mcArgs.push('--modListFile')
        if(this._lteMinorVersion(9)) {
            mcArgs.push(path.basename(this.fmlDir))
        } else {
            mcArgs.push('absolute:' + this.fmlDir)
        }
        

        // LiteLoader
        if(this.usingLiteLoader){
            mcArgs.push('--modRepo')
            mcArgs.push(this.llDir)

            // Set first arg to liteloader tweak class
            mcArgs.unshift('com.mumfrey.liteloader.launch.LiteLoaderTweaker')
            mcArgs.unshift('--tweakClass')
        }

        return mcArgs
    }

    /**
     * Ensure that the classpath entries all point to jar files.
     * 
     * @param {Array.<String>} list Array of classpath entries.
     */
    _processClassPathList(list) {

        const ext = '.jar'
        const extLen = ext.length
        for(let i=0; i<list.length; i++) {
            const extIndex = list[i].indexOf(ext)
            if(extIndex > -1 && extIndex  !== list[i].length - extLen) {
                list[i] = list[i].substring(0, extIndex + extLen)
            }
        }

    }

    _usesNeoForgeProductionClientProvider() {
        const gameArgs = this.modManifest?.arguments?.game ?? []
        return gameArgs.includes('--fml.neoForgeVersion') && gameArgs.includes('--fml.neoFormVersion')
    }

    /**
     * Resolve the full classpath argument list for this process. This method will resolve all Mojang-declared
     * libraries as well as the libraries declared by the server. Since mods are permitted to declare libraries,
     * this method requires all enabled mods as an input
     * 
     * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
     * @param {string} tempNativePath The path to store the native libraries.
     * @returns {Array.<string>} An array containing the paths of each library required by this process.
     */
    classpathArg(mods, tempNativePath){
        let cpArgs = []

        const shouldAddVanillaVersionJar = !this._usesNeoForgeProductionClientProvider()
            && (!mcVersionAtLeast('1.17', this.server.rawServer.minecraftVersion) || this.usingFabricLoader)

        // Forge/NeoForge 1.17+는 로더가 변환된 마인크래프트 jar를 따로 잡는다.
        // 이때 바닐라 version.jar를 같이 넣으면 같은 패키지를 가진 모듈이 중복되어 즉시 종료된다.
        if(shouldAddVanillaVersionJar) {
            const version = this.vanillaManifest.id
            cpArgs.push(path.join(this.commonDir, 'versions', version, version + '.jar'))
        }
        

        if(this.usingLiteLoader){
            cpArgs.push(this.llPath)
        }

        // Resolve the Mojang declared libraries.
        const mojangLibs = this._resolveMojangLibraries(tempNativePath)

        // Resolve the server declared libraries.
        const servLibs = this._resolveServerLibraries(mods)

        // Merge libraries, server libs with the same
        // maven identifier will override the mojang ones.
        const finalLibs = {...mojangLibs, ...servLibs}
        cpArgs = cpArgs.concat(Object.values(finalLibs)
            .filter(p => p.endsWith('.jar') || p.endsWith('.zip'))
            .filter(p => !p.includes('-srg.jar') && !p.includes('-extra.jar') && !p.includes('-universal.jar') && !p.includes('-client.jar'))
        )

        this._processClassPathList(cpArgs)

        return cpArgs
    }

    /**
     * Resolve the libraries defined by Mojang's version data. This method will also extract
     * native libraries and point to the correct location for its classpath.
     * 
     * TODO - clean up function
     * 
     * @param {string} tempNativePath The path to store the native libraries.
     * @returns {{[id: string]: string}} An object containing the paths of each library mojang declares.
     */
    _resolveMojangLibraries(tempNativePath){
        const nativesRegex = /.+:natives-([^-]+)(?:-(.+))?/
        const libs = {}

        const libArr = this.vanillaManifest.libraries
        fs.ensureDirSync(tempNativePath)
        for(let i=0; i<libArr.length; i++){
            const lib = libArr[i]
            if(isLibraryCompatible(lib.rules, lib.natives)){

                // Pre-1.19 has a natives object.
                if(lib.natives != null) {
                    // Extract the native library.
                    const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/']
                    const artifact = lib.downloads.classifiers[lib.natives[getMojangOS()].replace('${arch}', process.arch.replace('x', ''))]

                    // Location of native zip.
                    const to = path.join(this.libPath, artifact.path)

                    let zip = new AdmZip(to)
                    let zipEntries = zip.getEntries()

                    // Unzip the native zip.
                    for(let i=0; i<zipEntries.length; i++){
                        const fileName = zipEntries[i].entryName

                        let shouldExclude = false

                        // Exclude noted files.
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true
                            }
                        })

                        // Extract the file.
                        if(!shouldExclude){
                            fs.writeFile(path.join(tempNativePath, fileName), zipEntries[i].getData(), (err) => {
                                if(err){
                                    logger.error('Error while extracting native library:', err)
                                }
                            })
                        }

                    }
                }
                // 1.19+ logic
                else if(lib.name.includes('natives-')) {

                    const regexTest = nativesRegex.exec(lib.name)
                    // const os = regexTest[1]
                    const arch = regexTest[2] ?? 'x64'

                    if(arch != process.arch) {
                        continue
                    }

                    // Extract the native library.
                    const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/', '.git', '.sha1']
                    const artifact = lib.downloads.artifact

                    // Location of native zip.
                    const to = path.join(this.libPath, artifact.path)

                    let zip = new AdmZip(to)
                    let zipEntries = zip.getEntries()

                    // Unzip the native zip.
                    for(let i=0; i<zipEntries.length; i++){
                        if(zipEntries[i].isDirectory) {
                            continue
                        }

                        const fileName = zipEntries[i].entryName

                        let shouldExclude = false

                        // Exclude noted files.
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true
                            }
                        })

                        const extractName = fileName.includes('/') ? fileName.substring(fileName.lastIndexOf('/')) : fileName

                        // Extract the file.
                        if(!shouldExclude){
                            fs.writeFile(path.join(tempNativePath, extractName), zipEntries[i].getData(), (err) => {
                                if(err){
                                    logger.error('Error while extracting native library:', err)
                                }
                            })
                        }

                    }
                }
                // No natives
                else {
                    const dlInfo = lib.downloads
                    const artifact = dlInfo.artifact
                    const to = path.join(this.libPath, artifact.path)
                    const versionIndependentId = lib.name.substring(0, lib.name.lastIndexOf(':'))
                    libs[versionIndependentId] = to
                }
            }
        }

        return libs
    }

    /**
     * Resolve the libraries declared by this server in order to add them to the classpath.
     * This method will also check each enabled mod for libraries, as mods are permitted to
     * declare libraries.
     * 
     * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
     * @returns {{[id: string]: string}} An object containing the paths of each library this server requires.
     */
    _resolveServerLibraries(mods){
        const mdls = this.server.modules
        let libs = {}

        // Locate Forge/Fabric/Libraries
        for(let mdl of mdls){
            const type = mdl.rawModule.type
            if(type === Type.ForgeHosted || type === Type.Fabric || type === Type.Library){
                libs[mdl.getVersionlessMavenIdentifier()] = mdl.getPath()
                if(mdl.subModules.length > 0){
                    const res = this._resolveModuleLibraries(mdl)
                    if(res.length > 0){
                        libs = {...libs, ...res}
                    }
                }
            }
        }

        //Check for any libraries in our mod list.
        for(let i=0; i<mods.length; i++){
            if(mods.sub_modules != null){
                const res = this._resolveModuleLibraries(mods[i])
                if(res.length > 0){
                    libs = {...libs, ...res}
                }
            }
        }

        return libs
    }

    /**
     * Recursively resolve the path of each library required by this module.
     * 
     * @param {Object} mdl A module object from the server distro index.
     * @returns {Array.<string>} An array containing the paths of each library this module requires.
     */
    _resolveModuleLibraries(mdl){
        if(!mdl.subModules.length > 0){
            return []
        }
        let libs = []
        for(let sm of mdl.subModules){
            if(sm.rawModule.type === Type.Library){

                if(sm.rawModule.classpath ?? true) {
                    libs.push(sm.getPath())
                }
            }
            // If this module has submodules, we need to resolve the libraries for those.
            // To avoid unnecessary recursive calls, base case is checked here.
            if(mdl.subModules.length > 0){
                const res = this._resolveModuleLibraries(sm)
                if(res.length > 0){
                    libs = libs.concat(res)
                }
            }
        }
        return libs
    }

}

module.exports = ProcessBuilder
