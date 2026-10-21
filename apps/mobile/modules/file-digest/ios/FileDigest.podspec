Pod::Spec.new do |s|
  s.name           = 'FileDigest'
  s.version        = '0.0.0'
  s.summary        = 'SHA-256 of a file, read in parts off the JavaScript thread'
  s.description    = 'SHA-256 of a file, read in parts off the JavaScript thread'
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
