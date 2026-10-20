# Equivalente de generar-secretos.sh para PowerShell (Windows sin Git Bash).
# Uso (desde la raíz del repositorio):
#   powershell -ExecutionPolicy Bypass -File scripts\generar-secretos.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Creado .env a partir de .env.example"
}

New-Item -ItemType Directory -Force "secrets" | Out-Null

foreach ($nombre in "db_password", "db_app_password", "redis_password", "jwt_secret") {
    $archivo = "secrets\$nombre.txt"
    if ((Test-Path $archivo) -and (Get-Item $archivo).Length -gt 0) {
        Write-Host "Ya existe $archivo (no se toca)"
        continue
    }
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    # ASCII sin BOM ni salto de línea: el BOM rompería la contraseña dentro del contenedor
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $archivo), $hex, [System.Text.Encoding]::ASCII)
    Write-Host "Generado $archivo"
}
