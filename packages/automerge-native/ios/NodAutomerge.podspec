require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The library is rebuilt from the Rust sources on pod install whenever they no
# longer match what it was built from, so no build links a stale one.
unless system('node', File.join(__dir__, '..', 'scripts', 'build-ios.ts'))
  raise 'Could not build the native Automerge library. Install Rust with rustup, then run: pnpm --filter @nod/automerge-native build:ios'
end

Pod::Spec.new do |s|
  s.name           = 'NodAutomerge'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Nod contributors'
  s.homepage       = 'https://automerge.org'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.{h,swift}'
  s.vendored_frameworks = 'NodAutomergeCore.xcframework'
end
