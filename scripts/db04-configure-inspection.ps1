param([switch]$ConfigureMissing)
$ErrorActionPreference = 'Stop'
$secretPointer = [IntPtr]::Zero
try {
    $repo = Split-Path -Parent $PSScriptRoot
    $privateDirectory = Join-Path $repo '.local'
    $file = Join-Path $privateDirectory 'db04-inspection.env'
    if (!(Test-Path -LiteralPath $privateDirectory)) { New-Item -ItemType Directory -Path $privateDirectory | Out-Null }
    if ((Get-Item -LiteralPath $privateDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe private directory' }
    & git -C $repo check-ignore --quiet -- $file
    if ($LASTEXITCODE -ne 0) { throw 'Configuration must be ignored by Git' }
    $created = $false
    if (!(Test-Path -LiteralPath $file)) {
        $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $template = "# Personal FYP A catalog-only inspection. Never commit or share this file.`nDB04_INSPECTION_DATABASE_URL=`nDB04_INSPECTION_ROLE=`nDB04_INSPECTION_DATABASE=`nDB04_INSPECTION_PROJECT_NAME='FYP A'`nDB04_INSPECTION_PROJECT_REF=`nDB04_HOSTED_INSPECTION_AUTHORIZATION=FYP_A_READ_ONLY`n"
            $bytes = [Text.UTF8Encoding]::new($false).GetBytes($template)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
        $created = $true
    }
    if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe configuration link' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    if ($created) {
        $acl = Get-Acl -LiteralPath $file
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
        foreach ($identity in @($sid, $system)) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)) }
        Set-Acl -LiteralPath $file -AclObject $acl
    }
    $acl = Get-Acl -LiteralPath $file
    if (!$acl.AreAccessRulesProtected -or @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value, $system.Value) }).Count) { throw 'Private file permissions require review' }
    $content = [IO.File]::ReadAllText($file)
    $originalContent = $content
    $keys = @('DB04_INSPECTION_DATABASE_URL','DB04_INSPECTION_ROLE','DB04_INSPECTION_DATABASE','DB04_INSPECTION_PROJECT_REF')
    $values = @{}
    foreach ($key in $keys) {
        if ([regex]::Matches($content, "(?m)^$key=(.*)$").Count -ne 1) { throw 'Missing or duplicate configuration key' }
        $match = [regex]::Match($content, "(?m)^$key=(.*)$")
        $values[$key] = $match.Groups[1].Value.Trim().Trim("'").Trim('"')
    }
    $previouslyMissing = @($keys | Where-Object { !$values[$_] })
    if ($ConfigureMissing -and $previouslyMissing.Count) {
        foreach ($key in @('DB04_INSPECTION_PROJECT_REF','DB04_INSPECTION_ROLE','DB04_INSPECTION_DATABASE')) { if (!$values[$key]) { $values[$key] = Read-Host "Enter verified nonsecret $key" } }
        if ($values['DB04_INSPECTION_PROJECT_REF'] -notmatch '^[a-z0-9]{20}$' -or $values['DB04_INSPECTION_ROLE'] -notmatch '^[a-z_][a-z0-9_]{0,62}$' -or $values['DB04_INSPECTION_ROLE'] -in @('postgres','supabase_admin','service_role')) { throw 'Restricted identity/reference required' }
        if (!$values['DB04_INSPECTION_DATABASE_URL']) {
            $secure = Read-Host 'Enter the existing inspection connection URL privately (masked)' -AsSecureString
            $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
        } else { $plain = $values['DB04_INSPECTION_DATABASE_URL'] }
        try { $uri = [Uri]::new($plain) } catch { throw 'Invalid connection format' }
        if ($plain.Contains("'") -or $plain.Contains("`r") -or $plain.Contains("`n") -or $uri.Fragment -or $uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne "db.$($values['DB04_INSPECTION_PROJECT_REF']).supabase.co" -or $uri.Port -notin @(-1,5432) -or [Uri]::UnescapeDataString(($uri.UserInfo -split ':',2)[0]) -ne $values['DB04_INSPECTION_ROLE'] -or [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/')) -ne $values['DB04_INSPECTION_DATABASE'] -or ($uri.Query -and $uri.Query -notmatch '^\?sslmode=(require|verify-full)$')) { throw 'Connection target or TLS options do not match the declared personal project' }
        $values['DB04_INSPECTION_DATABASE_URL'] = $plain
        foreach ($key in $previouslyMissing) {
            $replacement = "$key='$($values[$key])'"
            $content = [regex]::Replace($content, "(?m)^$key=.*$", [Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement })
        }
        $writeStream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            $reader = [IO.StreamReader]::new($writeStream, [Text.Encoding]::UTF8, $true, 1024, $true)
            try { $currentContent = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($currentContent -cne $originalContent) { throw 'Configuration changed during prompting; preserving it' }
            $writeStream.Position = 0
            $writeStream.SetLength(0)
            $encoded = [Text.UTF8Encoding]::new($false).GetBytes($content)
            $writeStream.Write($encoded, 0, $encoded.Length)
        } finally { $writeStream.Dispose() }
        $plain = $null
    }
    $missing = @($keys | Where-Object { !$values[$_] })
    [ordered]@{prepared=$true;file=$file;gitIgnored=$true;privateAcl=$true;configured=($missing.Count -eq 0);missingKeys=$missing;hostedConnectionAttempted=$false} | ConvertTo-Json
} catch {
    Write-Output '{"prepared":false,"status":"BLOCKED","reason":"PRIVATE_CONFIGURATION_REVIEW_REQUIRED","secretsPrinted":false}'
    exit 2
} finally {
    if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
}
