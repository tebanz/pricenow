import { build, mergeConfig } from 'vite'
import configExport from '../vite.config.js'

const configEnv = {
  command: 'build',
  mode: process.env.MODE || 'production',
  isSsrBuild: false,
  isPreview: false,
}

const userConfig = typeof configExport === 'function'
  ? await configExport(configEnv)
  : configExport

await build(mergeConfig(userConfig || {}, { configFile: false }))
