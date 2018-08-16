# launchd

MacOS will want something like this:
```
```

# systemd

Linux will want something like this:

```
[Unit]
Description=Robert's GMail agent
After=network.target

[Service]
Type=simple
Restart=always
RestartSec=5
User=pi
Environment=TIMER=60000
ExecStart=/usr/bin/env node /Users/kieffer/projects/gmaul

[Install]
WantedBy=multi-user.target
```
