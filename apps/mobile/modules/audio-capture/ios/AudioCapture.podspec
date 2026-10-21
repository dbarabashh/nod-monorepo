Pod::Spec.new do |s|
  s.name           = 'AudioCapture'
  s.version        = '0.0.0'
  s.summary        = 'Microphone audio as 16 kHz mono PCM, kept in memory'
  s.description    = 'Microphone audio as 16 kHz mono PCM, kept in memory'
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
