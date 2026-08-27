const { spawn } = require('child_process');
const command = 'powershell.exe';
const args = ['-NoProfile', '-NonInteractive', '-Command', "@(Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.HardwareInterface -eq $true}).Count"];
const child = spawn(command, args, { windowsHide: true, shell: false });
let out = '';
let err = '';
child.stdout.on('data', c => out+=c);
child.stderr.on('data', c => err+=c);
child.on('close', () => console.log('OUT:', out, 'ERR:', err));
