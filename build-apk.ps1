# Genera el APK de "Combates D&D" listo para instalar en el movil.
#
#   .\build-apk.ps1              -> APK de depuracion (firmado con la clave de debug de Android)
#   .\build-apk.ps1 -Release     -> APK de release firmado con la clave local (release.keystore)
#
# El APK final se copia a la carpeta dist\ del proyecto.
# Requisitos (ya presentes en este equipo): JDK 17 y el SDK de Android 34.

param(
    [switch]$Release
)

# Los ejecutables nativos (npm, gradle) escriben avisos por stderr; con 'Stop' PowerShell 5.1
# los convertiria en errores terminantes, asi que comprobamos el codigo de salida a mano.
$ErrorActionPreference = 'Continue'
$proj = $PSScriptRoot
$sdk = 'C:\Users\Admin\Desktop\Proyectos\_godot_tools\android-sdk'

function Stop-With($msg) {
    Write-Host $msg -ForegroundColor Red
    exit 1
}

function Invoke-Step($what, [scriptblock]$block) {
    $global:LASTEXITCODE = 0
    & $block
    if ($LASTEXITCODE -ne 0) { Stop-With "FALLO: $what (codigo $LASTEXITCODE)" }
}

if (-not (Test-Path "$proj\app\index.html")) { Stop-With "Falta app\index.html" }
if (-not (Test-Path $sdk)) { Stop-With "No se encuentra el SDK de Android en $sdk" }

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

Write-Host "==> Copiando la web al proyecto Android (cap sync)" -ForegroundColor Cyan
Invoke-Step 'cap sync' { & npx cap sync android }

New-Item -ItemType Directory -Force -Path "$proj\dist" | Out-Null

if ($Release) {
    $keystore = "$proj\release.keystore"
    $storePass = 'dndcombate'

    if (-not (Test-Path $keystore)) {
        Write-Host "==> Creando la clave de firma local (una sola vez)" -ForegroundColor Cyan
        $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
        if (-not (Test-Path $keytool)) { $keytool = 'keytool' }
        Invoke-Step 'crear la clave de firma' {
            & $keytool -genkeypair -v -keystore $keystore -alias dndcombate -keyalg RSA -keysize 2048 -validity 10000 `
                -storepass $storePass -keypass $storePass -dname "CN=Combates DnD, O=Personal, C=ES"
        }
    }

    Write-Host "==> Compilando APK de release" -ForegroundColor Cyan
    Invoke-Step 'compilar el APK de release' {
        & "$proj\android\gradlew.bat" -p "$proj\android" assembleRelease --no-daemon --console=plain `
            "-Pandroid.injected.signing.store.file=$keystore" `
            "-Pandroid.injected.signing.store.password=$storePass" `
            "-Pandroid.injected.signing.key.alias=dndcombate" `
            "-Pandroid.injected.signing.key.password=$storePass"
    }

    $apk = "$proj\android\app\build\outputs\apk\release\app-release.apk"
    $out = "$proj\dist\combates-dnd.apk"
}
else {
    Write-Host "==> Compilando APK de depuracion" -ForegroundColor Cyan
    Invoke-Step 'compilar el APK de depuracion' {
        & "$proj\android\gradlew.bat" -p "$proj\android" assembleDebug --no-daemon --console=plain
    }

    $apk = "$proj\android\app\build\outputs\apk\debug\app-debug.apk"
    $out = "$proj\dist\combates-dnd-debug.apk"
}

if (-not (Test-Path $apk)) { Stop-With "No se genero el APK en $apk" }

Copy-Item $apk $out -Force
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ""
Write-Host "APK listo: $out  ($mb MB)" -ForegroundColor Green
Write-Host "Pasalo al movil (cable, Drive, Telegram...) y abrelo para instalarlo." -ForegroundColor Green
Write-Host "La primera vez Android pedira permiso para instalar apps de esta fuente." -ForegroundColor DarkGray
