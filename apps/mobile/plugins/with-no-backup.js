const fs = require('node:fs');
const path = require('node:path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const domains = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

const excludeAll = domains
  .map((domain) => `    <exclude domain="${domain}" path="." />`)
  .join('\n');

// allowBackup="false" alone doesn't stop a transfer to a new phone on some
// Android 12+ devices, so every domain is excluded for every kind of copy.
// The data key lives in the Keystore, which is never copied, so meetings on a
// new phone couldn't be read anyway; that phone pairs again instead.
const extractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludeAll}
  </cloud-backup>
  <device-transfer>
${excludeAll}
  </device-transfer>
</data-extraction-rules>
`;

const fullBackupContent = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludeAll.replaceAll('    ', '  ')}
</full-backup-content>
`;

module.exports = function withNoBackup(config) {
  config = withDangerousMod(config, [
    'android',
    (next) => {
      const directory = path.join(
        next.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'nod_data_extraction_rules.xml'),
        extractionRules,
      );
      fs.writeFileSync(
        path.join(directory, 'nod_backup_rules.xml'),
        fullBackupContent,
      );
      return next;
    },
  ]);
  return withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      application.$['android:fullBackupContent'] = '@xml/nod_backup_rules';
      application.$['android:dataExtractionRules'] =
        '@xml/nod_data_extraction_rules';
    }
    return next;
  });
};
