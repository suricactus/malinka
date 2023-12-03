# malinka

## Deployment

The program will be controlled by `supervisor.d`. Add the following configuration `/etc/supervisor/conf.d/tec-osogovska.conf`.

```
[program:tec-osogovska]
command=node /usr/share/tec-osogovska/server.js
user=tec-osogovska
autostart=true
autorestart=true
directory=/usr/share/tec-osogovska
stderr_logfile=/var/log/tec-osogovska.err.log
stdout_logfile=/var/log/tec-osogovska.out.log
```
