Pod::Spec.new do |s|
  s.name = 'AXXTelemetryIOS'
  s.version = '1.0.0'
  s.summary = 'Independent native telemetry and WebView context SDK.'
  s.description = <<-DESC
    Self-hosted native telemetry copy for iOS applications. The core does not
    depend on or intercept Umeng SDK traffic. Official Umeng integration is
    intentionally a separate optional adapter.
  DESC
  s.homepage = 'https://example.invalid/axx-telemetry-ios'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = { 'Local Integration' => 'local@example.invalid' }
  s.source = { :path => '.' }
  s.platform = :ios, '12.0'
  s.source_files = 'AXXTelemetryIOS/**/*.{h,m}'
  s.public_header_files = 'AXXTelemetryIOS/*.h'
  s.frameworks = 'Foundation', 'UIKit', 'Network', 'CoreTelephony'
  s.weak_frameworks = 'MetricKit'
end
