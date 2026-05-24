const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const AdmZip = require('adm-zip')

const CURSEFORGE_NEOFORGE_JSON = 'C:\\Users\\JISUNG\\curseforge\\minecraft\\Install\\versions\\neoforge-21.1.220\\neoforge-21.1.220.json'
const OUTPUT_JSON = path.join(__dirname, 'distribution.json')
const APP_VERSION = '1.0.16'
const SERVER_NAME = 'Pokevill'
const SERVER_ADDRESS = 'reade.p-e.kr'
const DEFAULT_SHADERPACK = 'ComplementaryUnbound_r5.5.1.zip'
const GITHUB_RELEASE_REPOSITORY = 'phans913/pokevilllauncher'
const GITHUB_RELEASE_TAG = `v${APP_VERSION}`
const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases/download/${GITHUB_RELEASE_TAG}`
const GOOGLE_DRIVE_MANIFEST = path.join(__dirname, 'google_drive_files.json')
const USE_GOOGLE_DRIVE = fs.existsSync(GOOGLE_DRIVE_MANIFEST)
const googleDriveFiles = USE_GOOGLE_DRIVE ? JSON.parse(fs.readFileSync(GOOGLE_DRIVE_MANIFEST, 'utf8')) : {}
const SOURCE_MODPACK_DIR = path.join(__dirname, '..', '포켓빌 프록시 docker', '포켓빌 최종 모드팩')
const SOURCE_SHADERPACK = path.join(__dirname, '..', '포켓빌 프록시 docker', DEFAULT_SHADERPACK)
const BUNDLE_ROOT = path.join(__dirname, 'Pokevill_GoogleDrive_Bundle')
const DEFAULTS_DIR = path.join(__dirname, 'app', 'assets', 'defaults')

function getGoogleDriveDownloadUrl(fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`
}

function getGithubReleaseAssetName(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, '/')

    if(normalizedPath.endsWith('/version.json') && normalizedPath.includes('/neoforge/21.1.220/')) {
        return 'neoforge-21.1.220.json'
    }

    const assetName = path.basename(normalizedPath)

    if(assetName === 'pokevillgacha-1.0.0 (3).jar') {
        return 'pokevillgacha-1.0.0.3.jar'
    }

    return assetName
}

function resolveArtifactUrl(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, '/')
    const fileId = googleDriveFiles[normalizedPath]

    if(fileId) {
        return getGoogleDriveDownloadUrl(fileId)
    }

    if(USE_GOOGLE_DRIVE) {
        throw new Error(`Missing Google Drive file id for ${normalizedPath}`)
    }

    return `${GITHUB_RELEASE_BASE}/${encodeURIComponent(getGithubReleaseAssetName(normalizedPath))}`
}

function resolveBundleRoot() {
    const candidates = [
        BUNDLE_ROOT,
        path.join(__dirname, '..', 'Pokevill_GoogleDrive_Bundle')
    ]

    for(const candidate of candidates) {
        if(candidate && fs.existsSync(candidate)) {
            return candidate
        }
    }

    throw new Error(`Bundle root not found. Checked: ${candidates.join(', ')}`)
}

function copyRecursiveSync(source, target) {
    const stat = fs.statSync(source)

    if(stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true })
        for(const child of fs.readdirSync(source)) {
            copyRecursiveSync(path.join(source, child), path.join(target, child))
        }
        return
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
}

function normalizeResourcepackName(fileName) {
    if(fileName === 'pokevill (2).zip') {
        return 'pokevill.zip'
    }

    if(fileName === 'BM Jua.zip') {
        return 'BM.Jua.zip'
    }

    return fileName
}

function syncModpackContent(bundleRoot) {
    const targetModpackDir = path.join(bundleRoot, 'instances', 'pokevill')
    const targetModsDir = path.join(targetModpackDir, 'mods')
    const targetResourcepacksDir = path.join(targetModpackDir, 'resourcepacks')
    const targetShaderpacksDir = path.join(targetModpackDir, 'shaderpacks')
    const sourceModsDir = path.join(SOURCE_MODPACK_DIR, 'mods')
    const sourceResourcepacksDir = path.join(SOURCE_MODPACK_DIR, 'resourcepacks')

    if(!fs.existsSync(SOURCE_MODPACK_DIR)) {
        throw new Error(`Source modpack not found: ${SOURCE_MODPACK_DIR}`)
    }

    if(!fs.existsSync(SOURCE_SHADERPACK)) {
        throw new Error(`Default shaderpack not found: ${SOURCE_SHADERPACK}`)
    }

    fs.rmSync(targetModpackDir, { recursive: true, force: true })
    fs.mkdirSync(targetModsDir, { recursive: true })
    fs.mkdirSync(targetResourcepacksDir, { recursive: true })
    fs.mkdirSync(targetShaderpacksDir, { recursive: true })

    for(const fileName of fs.readdirSync(sourceModsDir)) {
        const sourcePath = path.join(sourceModsDir, fileName)
        if(fs.statSync(sourcePath).isFile() && fileName.toLowerCase().endsWith('.jar')) {
            fs.copyFileSync(sourcePath, path.join(targetModsDir, fileName))
        }
    }

    for(const fileName of fs.readdirSync(sourceResourcepacksDir)) {
        const sourcePath = path.join(sourceResourcepacksDir, fileName)
        if(fs.statSync(sourcePath).isFile() && fileName.toLowerCase().endsWith('.zip')) {
            const targetName = normalizeResourcepackName(fileName)
            copyRecursiveSync(sourcePath, path.join(targetResourcepacksDir, targetName))
        }
    }

    fs.copyFileSync(SOURCE_SHADERPACK, path.join(targetShaderpacksDir, DEFAULT_SHADERPACK))
}

function getSHA1(filePath) {
    const fileBuffer = fs.readFileSync(filePath)
    const hashSum = crypto.createHash('sha1')
    hashSum.update(fileBuffer)
    return hashSum.digest('hex')
}

function sanitizeArtifactName(fileName) {
    return path.basename(fileName, path.extname(fileName))
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'module'
}

function createModule(filePath, relPath, stat, sequence) {
    const file = path.basename(filePath)

    if(relPath.startsWith('mods/') && file.toLowerCase().endsWith('.jar')) {
        return {
            id: `pokevill.mods:${sanitizeArtifactName(file)}:${sequence}`,
            name: file,
            type: 'ForgeMod',
            artifact: {
                size: stat.size,
                MD5: null,
                hash: getSHA1(filePath),
                path: relPath,
                url: resolveArtifactUrl(relPath)
            }
        }
    }

    return {
        id: relPath.replace(/([^a-zA-Z0-9.\-_])/g, ''),
        name: file,
        type: 'File',
        artifact: {
            size: stat.size,
            MD5: null,
            hash: getSHA1(filePath),
            path: relPath,
            url: resolveArtifactUrl(relPath)
        }
    }
}

function scanDir(dir, baseDir = dir) {
    let results = []
    const list = fs.readdirSync(dir)

    for(const file of list) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if(stat && stat.isDirectory()) {
            results = results.concat(scanDir(filePath, baseDir))
            continue
        }

        const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/')

        if(relPath.startsWith('mods/') && !file.toLowerCase().endsWith('.jar')) {
            continue
        }

        if(relPath.startsWith('resourcepacks/') && !file.toLowerCase().endsWith('.zip')) {
            continue
        }

        if(relPath.startsWith('shaderpacks/') && !file.toLowerCase().endsWith('.zip')) {
            continue
        }

        if(relPath.startsWith('mods/') || relPath.startsWith('resourcepacks/') || relPath.startsWith('shaderpacks/')) {
            results.push(createModule(filePath, relPath, stat, results.length + 1))
        }
    }

    return results
}

function nbtName(name) {
    const value = Buffer.from(name, 'utf8')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(value.length)
    return Buffer.concat([length, value])
}

function nbtString(name, value) {
    return Buffer.concat([
        Buffer.from([0x08]),
        nbtName(name),
        nbtName(value)
    ])
}

function nbtByte(name, value) {
    return Buffer.concat([
        Buffer.from([0x01]),
        nbtName(name),
        Buffer.from([value])
    ])
}

function createServersDat() {
    const listLength = Buffer.alloc(4)
    listLength.writeInt32BE(1)

    const serverCompound = Buffer.concat([
        nbtString('name', SERVER_NAME),
        nbtString('ip', SERVER_ADDRESS),
        nbtByte('acceptTextures', 1),
        Buffer.from([0x00])
    ])

    return Buffer.concat([
        Buffer.from([0x0a]),
        nbtName(''),
        Buffer.from([0x09]),
        nbtName('servers'),
        Buffer.from([0x0a]),
        listLength,
        serverCompound,
        Buffer.from([0x00])
    ])
}

function createDefaultIrisProperties() {
    return [
        '#This file stores configuration options for Iris, such as the currently active shaderpack',
        `#Generated by Pokevill Launcher ${APP_VERSION}`,
        'allowUnknownShaders=false',
        'colorSpace=SRGB',
        'disableUpdateMessage=false',
        'enableDebugOptions=false',
        'enableShaders=true',
        'maxShadowRenderDistance=32',
        `shaderPack=${DEFAULT_SHADERPACK}`,
        ''
    ].join('\n')
}

function writeDefaultIrisProperties(bundleRoot) {
    const irisProperties = createDefaultIrisProperties()
    const defaultsConfigDir = path.join(DEFAULTS_DIR, 'config')
    const targetConfigDir = path.join(bundleRoot, 'instances', 'pokevill', 'config')

    fs.mkdirSync(defaultsConfigDir, { recursive: true })
    fs.mkdirSync(targetConfigDir, { recursive: true })
    fs.writeFileSync(path.join(defaultsConfigDir, 'iris.properties'), irisProperties, 'utf8')
    fs.writeFileSync(path.join(targetConfigDir, 'iris.properties'), irisProperties, 'utf8')
}

function writeDefaultServersDat(bundleRoot) {
    const serversDat = createServersDat()
    const targetModpackDir = path.join(bundleRoot, 'instances', 'pokevill')

    fs.mkdirSync(DEFAULTS_DIR, { recursive: true })
    fs.mkdirSync(targetModpackDir, { recursive: true })
    fs.writeFileSync(path.join(DEFAULTS_DIR, 'servers.dat'), serversDat)
    fs.writeFileSync(path.join(targetModpackDir, 'servers.dat'), serversDat)
}

const dataPath = path.join(os.homedir(), 'AppData', 'Roaming', '.Pokevill')

const vanillaLibraries = new Set()
try {
    const vanillaPath = path.join(dataPath, 'common', 'versions', '1.21.1', '1.21.1.json')
    if(fs.existsSync(vanillaPath)) {
        const vanillaManifest = JSON.parse(fs.readFileSync(vanillaPath, 'utf-8'))
        vanillaManifest.libraries.forEach(lib => vanillaLibraries.add(lib.name))
        console.log(`Loaded ${vanillaLibraries.size} vanilla libraries for deduplication.`)
    }
} catch(err) {
    console.error('Failed to load vanilla manifest for deduplication', err)
}

async function build() {
    const bundleRoot = resolveBundleRoot()
    syncModpackContent(bundleRoot)
    writeDefaultServersDat(bundleRoot)
    writeDefaultIrisProperties(bundleRoot)

    const targetModpackDir = path.join(bundleRoot, 'instances', 'pokevill')
    const bundleLibraryDir = path.join(bundleRoot, 'common', 'libraries')

    console.log('Scanning user modpack...')
    const modules = scanDir(targetModpackDir)

    console.log('Reading NeoForge manifest...')
    const nfManifest = JSON.parse(fs.readFileSync(CURSEFORGE_NEOFORGE_JSON, 'utf8'))

    const dummyJson = JSON.stringify({
        id: '21.1.220',
        time: '2024-01-01T00:00:00Z',
        releaseTime: '2024-01-01T00:00:00Z',
        type: 'release',
        mainClass: nfManifest.mainClass,
        minecraftArguments: '',
        arguments: nfManifest.arguments,
        libraries: []
    })

    fs.writeFileSync(path.join(__dirname, 'version.json'), dummyJson)
    const dummyZip = new AdmZip()
    dummyZip.addFile('version.json', Buffer.from(dummyJson, 'utf8'))
    dummyZip.writeZip(path.join(__dirname, 'dummy.jar'))

    const dummyStat = fs.statSync(path.join(__dirname, 'dummy.jar'))
    const dummyHash = getSHA1(path.join(__dirname, 'dummy.jar'))
    const versionStat = fs.statSync(path.join(__dirname, 'version.json'))
    const versionHash = getSHA1(path.join(__dirname, 'version.json'))

    const loader = {
        id: 'net.neoforged:neoforge:21.1.220',
        type: 'ForgeHosted',
        artifact: {
            size: dummyStat.size,
            MD5: null,
            hash: dummyHash,
            path: 'net/neoforged/neoforge/21.1.220/neoforge-21.1.220.jar',
            url: resolveArtifactUrl('dummy.jar')
        },
        subModules: [
            {
                id: 'neoforge-21.1.220',
                type: 'VersionManifest',
                artifact: {
                    size: versionStat.size,
                    MD5: null,
                    hash: versionHash,
                    path: 'net/neoforged/neoforge/21.1.220/version.json',
                    url: resolveArtifactUrl('version.json')
                }
            },
            ...nfManifest.libraries
                .filter(lib => !vanillaLibraries.has(lib.name))
                .map(lib => ({
                    id: lib.name,
                    type: 'Library',
                    artifact: {
                        size: lib.downloads.artifact.size,
                        MD5: null,
                        hash: lib.downloads.artifact.sha1,
                        path: lib.downloads.artifact.path,
                        url: lib.downloads.artifact.url
                    }
                })),
            {
                id: 'net.minecraft:client:1.21.1-20240808.144430:srg',
                type: 'Library',
                artifact: {
                    size: fs.statSync(path.join(bundleLibraryDir, 'net', 'minecraft', 'client', '1.21.1-20240808.144430', 'client-1.21.1-20240808.144430-srg.jar')).size,
                    MD5: null,
                    hash: getSHA1(path.join(bundleLibraryDir, 'net', 'minecraft', 'client', '1.21.1-20240808.144430', 'client-1.21.1-20240808.144430-srg.jar')),
                    path: 'net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-srg.jar',
                    url: resolveArtifactUrl('client-1.21.1-20240808.144430-srg.jar')
                }
            },
            {
                id: 'net.minecraft:client:1.21.1-20240808.144430:extra',
                type: 'Library',
                artifact: {
                    size: fs.statSync(path.join(bundleLibraryDir, 'net', 'minecraft', 'client', '1.21.1-20240808.144430', 'client-1.21.1-20240808.144430-extra.jar')).size,
                    MD5: null,
                    hash: getSHA1(path.join(bundleLibraryDir, 'net', 'minecraft', 'client', '1.21.1-20240808.144430', 'client-1.21.1-20240808.144430-extra.jar')),
                    path: 'net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-extra.jar',
                    url: resolveArtifactUrl('client-1.21.1-20240808.144430-extra.jar')
                }
            },
            {
                id: 'net.neoforged:neoforge:21.1.220:client',
                type: 'Library',
                artifact: {
                    size: fs.statSync(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-client.jar')).size,
                    MD5: null,
                    hash: getSHA1(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-client.jar')),
                    path: 'net/neoforged/neoforge/21.1.220/neoforge-21.1.220-client.jar',
                    url: resolveArtifactUrl('neoforge-21.1.220-client.jar')
                }
            },
            {
                id: 'net.neoforged:neoforge:21.1.220:universal',
                type: 'Library',
                artifact: {
                    size: fs.statSync(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-universal.jar')).size,
                    MD5: null,
                    hash: getSHA1(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-universal.jar')),
                    path: 'net/neoforged/neoforge/21.1.220/neoforge-21.1.220-universal.jar',
                    url: resolveArtifactUrl('neoforge-21.1.220-universal.jar')
                }
            },
            {
                id: 'net.neoforged:neoforge:21.1.220:clientdata@lzma',
                type: 'Library',
                artifact: {
                    size: fs.statSync(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-clientdata.lzma')).size,
                    MD5: null,
                    hash: getSHA1(path.join(bundleLibraryDir, 'net', 'neoforged', 'neoforge', '21.1.220', 'neoforge-21.1.220-clientdata.lzma')),
                    path: 'net/neoforged/neoforge/21.1.220/neoforge-21.1.220-clientdata.lzma',
                    url: resolveArtifactUrl('neoforge-21.1.220-clientdata.lzma')
                }
            }
        ],
        minecraftArguments: '',
        mainClass: nfManifest.mainClass,
        arguments: nfManifest.arguments
    }

    const distribution = {
        version: APP_VERSION,
        servers: [
            {
                id: 'pokevill',
                name: 'Pokevill Server',
                description: 'NeoForge 1.21.1',
                icon: 'https://mc-heads.net/avatar/Notch',
                version: '1.21.1',
                address: SERVER_ADDRESS,
                minecraftVersion: '1.21.1',
                autoconnect: true,
                javaOptions: {
                    supported: '>=21 <22',
                    suggestedMajor: 21,
                    distribution: 'TEMURIN',
                    ram: {
                        recommended: 4096,
                        minimum: 3072
                    }
                },
                discord: {
                    shortId: 'pokevill',
                    largeImageText: 'Pokevill',
                    largeImageKey: 'logo'
                },
                modules: [loader, ...modules]
            }
        ]
    }

    const distributionJson = JSON.stringify(distribution, null, 2)
    fs.writeFileSync(OUTPUT_JSON, distributionJson)
    fs.writeFileSync(path.join(bundleRoot, 'distribution.json'), distributionJson)
    console.log('Generated distribution.json at', OUTPUT_JSON)
}

build().catch(console.error)
