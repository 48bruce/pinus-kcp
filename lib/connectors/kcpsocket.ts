/**
 * Copyright 2016 leenjewel
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import * as kcp from 'node-kcp-x';
import * as pinuscoder from './pinuscoder';
import * as protocol from 'pinus-protocol';
const Package = protocol.Package;
import * as dgram from 'dgram';
import { ISocket } from '../interfaces/ISocket';

const ST_INITED = 0;
const ST_WAIT_ACK = 1;
const ST_WORKING = 2;
const ST_CLOSED = 3;

enum State {
    INITED = 0,
    WAIT_ACK = 1,
    WORKING = 2,
    CLOSED = 3,
};

var output = function (data: any, size: number, thiz: any) {
    thiz.socket.send(data, 0, size, thiz.port, thiz.host);
};

export default class KcpSocket extends EventEmitter implements ISocket {
    id: number;
    socket: dgram.Socket;
    host: string;
    port: number;
    remoteAddress: any;
    opts: any;
    kcpObj: kcp.KCP | null;
    state: number;
    _initTimer: NodeJS.Timer | null;

    constructor(id: number, socket: dgram.Socket, address: string, port: number, opts: any) {
        super();
        this.id = id;
        this.socket = socket;
        this.host = address;
        this.port = port;
        this.remoteAddress = {
            ip: this.host,
            port: this.port
        };
        this.opts = opts;
        var conv = opts.conv || 123;
        this.kcpObj = new kcp.KCP(conv, this);
        if (!!opts) {
            var nodelay = opts.nodelay || 0;
            var interval = opts.interval || 100;
            var resend = opts.resend || 0;
            var nc = opts.nc || 0;
            this.kcpObj.nodelay(nodelay, interval, resend, nc);

            var sndwnd = opts.sndwnd || 32;
            var rcvwnd = opts.rcvwnd || sndwnd;
            this.kcpObj.wndsize(sndwnd, rcvwnd);

            var mtu = opts.mtu || 1400;
            this.kcpObj.setmtu(mtu);
        }
        this.kcpObj.output(output);
        this.on('input', (msg) => {
            if (!this.kcpObj) {
                return;
            }
            this.kcpObj.input(msg);
            var data = this.kcpObj.recv();
            if (!!data) {
                if (this.opts) {
                    pinuscoder.handlePackage(this, data);
                } else {
                    this.emit('message', data);
                }
            }
        });

        this.check();
        this.state = ST_INITED;

        // 超时还未握手就绪，就删除此 socket
        this._initTimer = setTimeout(() => {
            if (this.state === ST_INITED
                || this.state !== ST_WORKING) {
                this.disconnect();
            }
            this._initTimer = null;
        }, 5000);
    }

    check() {
        if (!this.kcpObj) {
            return;
        }
        const now = Date.now();
        this.kcpObj.update(now);
        setTimeout(() => {
            this.check();
        }, this.kcpObj.check(now));
    }

    send(msg: any) {
        if (this.state != ST_WORKING) {
            return;
        }
        if (typeof msg === 'string') {
            msg = Buffer.from(msg);
        } else if (!(msg instanceof Buffer)) {
            msg = Buffer.from(JSON.stringify(msg));
        }
        this.sendRaw(Package.encode(Package.TYPE_DATA, msg));
    }

    sendRaw(msg: Buffer) {
        if (!this.kcpObj) {
            return;
        }
        this.kcpObj.send(msg);
        this.kcpObj.flush();
    }

    sendForce(msg: Buffer) {
        if (this.state == ST_CLOSED) {
            return;
        }
        this.sendRaw(msg);
    }

    sendBatch(msgs: Buffer[]) {
        if (this.state != ST_WORKING) {
            return;
        }
        var rs = [];
        for (var i = 0; i < msgs.length; i++) {
            rs.push(Package.encode(Package.TYPE_DATA, msgs[i]));
        }
        this.sendRaw(Buffer.concat(rs));
    }

    handshakeResponse(resp: Buffer) {
        if (this.state !== ST_INITED) {
            return;
        }
        this.sendRaw(resp);
        this.state = ST_WAIT_ACK;
    }

    disconnect() {
        if (this.state == ST_CLOSED) {
            return;
        }
        this.state = ST_CLOSED;
        this.emit('disconnect', 'kcp connection disconnected');
        if (this.kcpObj) {
            this.kcpObj.release();
            this.kcpObj = null;
        }
    }
}