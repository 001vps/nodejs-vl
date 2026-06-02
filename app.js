const http = require('http');
const url = require('url');
const { exec } = require('child_process');
const WebSocket = require('ws');
const net = require('net');
const { createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');

// 配置
const port = process.env.PORT || 3000; // HTTP 和 WebSocket 使用同一个端口
const uuid = (process.env.UUID || '24b4b1e1-7a89-45f6-858c-242cf53b5bdb').replace(/-/g, "");

// 日志和错误处理
const logcb = (...args) => console.log.bind(this, ...args);
const errcb = (...args) => console.error.bind(this, ...args);

// 允许的命令列表
const allowedCommands = ['ps aux', 'pwd', 'chmod +x ./js.sh', 'ping -c 2 www.haodianxin.cn', 'crontab -l', 'devil port list', 'devil www list'];

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // 如果是 GET 请求，返回 HTML 页面
    if (req.method === 'GET' && parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Command Executor</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 20px;
                        padding: 20px;
                    }
                    textarea {
                        width: 100%;
                        height: 200px;
                        margin-top: 10px;
                        font-family: monospace;
                    }
                    button {
                        margin-top: 10px;
                        padding: 10px 20px;
                        font-size: 16px;
                    }
                    input, select {
                        width: 100%;
                        padding: 10px;
                        font-size: 16px;
                        margin-top: 10px;
                    }
                </style>
            </head>
            <body>
                <h1>Command Executor</h1>
                <label for="command">Enter or Select a Command:</label>
                <input type="text" id="command" placeholder="Enter your command here">
                <select id="predefined-commands" onchange="updateCommand()">
                    <option value="">-- Select a predefined command --</option>
                    <option value="ps aux">ps aux</option>
                    <option value="crontab -l">crontab -l</option>
                    <option value="pwd">pwd</option>
                    <option value="devil port list">devil port list</option>
                    <option value="devil www list">devil www list</option>
                    <option value="ping -c 2 www.haodianxin.cn">ping -c 2 www.haodianxin.cn</option>
                    <option value="chmod +x ./js.sh">chmod +x ./js.sh</option>
                </select>
                <button onclick="runCommand()">Run Command</button>
                <h2>Output:</h2>
                <textarea id="output" readonly></textarea>

                <script>
                    function updateCommand() {
                        const selectedCommand = document.getElementById('predefined-commands').value;
                        document.getElementById('command').value = selectedCommand;
                    }

                    function runCommand() {
                        const command = document.getElementById('command').value;

                        if (!command) {
                            alert('Please enter or select a command.');
                            return;
                        }

                        fetch('/run', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ command }),
                        })
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('HTTP error ' + response.status);
                            }
                            return response.json();
                        })
                        .then(data => {
                            document.getElementById('output').value = data.output;
                        })
                        .catch(err => {
                            document.getElementById('output').value = 'Error: ' + err.message;
                        });
                    }

                    document.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            runCommand();
                        }
                    });
                </script>
            </body>
            </html>
        `);
    }
    // 如果是 POST 请求，执行命令
    else if (req.method === 'POST' && parsedUrl.pathname === '/run') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            const { command } = JSON.parse(body);

            // 验证命令是否在允许列表中


            // 执行命令
            exec(command, (error, stdout, stderr) => {
                let output = "";

                if (error) {
                    output = `Error: ${error.message}`;
                } else if (stderr) {
                    output = `Stderr: ${stderr}`;
                } else {
                    output = stdout || "Command executed successfully.";
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ output }));
            });
        });
    }
    // 处理 404
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// 创建 WebSocket 服务器，绑定到 HTTP 服务器
const WebSocketServer = new WebSocket.Server({ server });

WebSocketServer.on('connection', ws => {
    console.log("WebSocket connection established");

    ws.once('message', msg => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);
        if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;

        let i = msg.slice(17, 18).readUInt8() + 19;
        const port = msg.slice(i, i += 2).readUInt16BE(0);
        const ATYP = msg.slice(i, i += 1).readUInt8();

        const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') : // IPV4
            (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) : // domain
                (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));

        logcb('conn:', host, port);
        ws.send(new Uint8Array([VERSION, 0]));
        const duplex = createWebSocketStream(ws);

        net.connect({ host, port }, function () {
            this.write(msg.slice(i));
            duplex.on('error', errcb('E1:')).pipe(this).on('error', errcb('E2:')).pipe(duplex);
        }).on('error', errcb('Conn-Err:', { host, port }));
    }).on('error', errcb('EE:'));
});

// 启动服务器
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
