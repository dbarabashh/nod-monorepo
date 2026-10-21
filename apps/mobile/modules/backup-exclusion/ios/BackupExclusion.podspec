Pod::Spec.new do |s|
  s.name           = 'BackupExclusion'
  s.version        = '0.0.0'
  s.summary        = 'Keeps files and folders out of iCloud and computer backups'
  s.description    = 'Keeps files and folders out of iCloud and computer backups'
  s.license        = 'MIT'
  s.author         = 'Nod contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.swift'
end
