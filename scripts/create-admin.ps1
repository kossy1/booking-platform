# scripts\create-admin.ps1
# Creates a superadmin user with a bcrypt-hashed password.

param(
    [string]$Email    = 'superadmin@admin.com',
    [string]$Password = 'admin123',
    [string]$FullName = 'Super Admin'
)

$ErrorActionPreference = 'Stop'

Write-Host "Generating bcrypt hash..." -ForegroundColor Cyan

# Use the bcrypt in node_modules to hash the password
$hashScript = @"
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(process.argv[2], 12);
process.stdout.write(hash);
"@

$hashFile = Join-Path $env:TEMP 'hash-pw.mjs'
$hashScript | Out-File -Encoding utf8 $hashFile

$hash = & node $hashFile $Password
Remove-Item $hashFile -ErrorAction SilentlyContinue

if (-not $hash -or $hash.Length -lt 20) {
    throw "Failed to generate hash. Got: $hash"
}

Write-Host "Hash: $hash" -ForegroundColor DarkGray

# Generate a UUID for the user id
$userId = [guid]::NewGuid().ToString()

Write-Host "Inserting user $Email ..." -ForegroundColor Cyan

$sql = @"
USE booking;

INSERT INTO users (
  id, email, full_name, password_hash, role,
  email_verified, timezone, locale
) VALUES (
  '$userId',
  '$Email',
  '$FullName',
  '$hash',
  'admin',
  1,
  'Africa/Lagos',
  'en'
)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  role          = 'admin',
  email_verified = 1,
  deleted_at    = NULL;
"@

$sqlFile = Join-Path $env:TEMP 'create-admin.sql'
$sql | Out-File -Encoding utf8 $sqlFile

# Run via mysql
& mysql -u root booking -e "source $sqlFile"
Remove-Item $sqlFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✅ Admin created:" -ForegroundColor Green
Write-Host "   Email:    $Email"
Write-Host "   Password: $Password"
Write-Host "   Role:     admin"
Write-Host "   ID:       $userId"
Write-Host ""
Write-Host "Sign in at: http://localhost:3001/admin-login.html" -ForegroundColor Yellow