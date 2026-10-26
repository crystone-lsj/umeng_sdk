Pod::Spec.new do |s|
  s.name = 'AXXUmengSampled'
  s.version = '1.0.0'
  s.summary = 'Feature-level sampling gateway for the official Umeng iOS SDKs.'
  s.description = <<-DESC
    An Objective-C integration layer that wraps public Umeng APIs and adds
    deterministic, runtime-adjustable per-feature sampling. Official Umeng
    CocoaPods components remain required at runtime.
  DESC
  s.homepage = 'https://example.invalid/axx-umeng-compatible-ios'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = { 'Local Integration' => 'local@example.invalid' }
  s.source = { :path => '.' }
  s.platform = :ios, '12.0'
  s.swift_version = '5.0'

  s.source_files = 'AXXUmengSampled/**/*.{h,m}'
  s.public_header_files = 'AXXUmengSampled/*.h'
  s.frameworks = 'Foundation', 'UIKit'

  s.dependency 'UMCommon', '~> 7.5.8'
  s.dependency 'UMDevice', '~> 3.5.0'
  s.dependency 'UMAPM', '~> 2.0.7'
end
