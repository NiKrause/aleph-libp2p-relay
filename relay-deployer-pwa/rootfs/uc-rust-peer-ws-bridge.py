#!/usr/bin/env python3
import asyncio
import os
from contextlib import suppress

from websockets.server import serve


LISTEN_HOST = os.environ.get("WS_BRIDGE_LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("WS_BRIDGE_LISTEN_PORT", "9093"))
TARGET_HOST = os.environ.get("WS_BRIDGE_TARGET_HOST", "127.0.0.1")
TARGET_PORT = int(os.environ.get("WS_BRIDGE_TARGET_PORT", "9092"))


async def bridge(websocket) -> None:
    reader, writer = await asyncio.open_connection(TARGET_HOST, TARGET_PORT)

    async def ws_to_tcp() -> None:
        try:
            async for message in websocket:
                data = message.encode("utf-8") if isinstance(message, str) else message
                writer.write(data)
                await writer.drain()
        finally:
            with suppress(Exception):
                writer.close()
                await writer.wait_closed()

    async def tcp_to_ws() -> None:
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    break
                await websocket.send(chunk)
        finally:
            with suppress(Exception):
                await websocket.close()

    ws_task = asyncio.create_task(ws_to_tcp())
    tcp_task = asyncio.create_task(tcp_to_ws())
    done, pending = await asyncio.wait({ws_task, tcp_task}, return_when=asyncio.FIRST_COMPLETED)

    for task in pending:
        task.cancel()
    for task in done:
        with suppress(Exception):
            await task


async def main() -> None:
    async with serve(bridge, LISTEN_HOST, LISTEN_PORT, max_size=None, max_queue=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
