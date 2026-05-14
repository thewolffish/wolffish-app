import { notarize } from '@electron/notarize'
import type { AfterPackContext } from 'app-builder-lib'

export default async function notarizeMacos(context: AfterPackContext): Promise<void> {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename

  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID!,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
    teamId: process.env.APPLE_TEAM_ID!
  })
}
