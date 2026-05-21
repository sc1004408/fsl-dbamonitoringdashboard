# Run in elevated PowerShell on INCH-VITFS01

Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole -All
Enable-WindowsOptionalFeature -Online -FeatureName IIS-ISAPIFilter -All
Enable-WindowsOptionalFeature -Online -FeatureName IIS-ISAPIExtensions -All

Write-Host "Install URL Rewrite and ARR modules manually if not present."
Write-Host "URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite"
Write-Host "ARR: https://www.iis.net/downloads/microsoft/application-request-routing"
