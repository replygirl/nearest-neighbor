// Custom server entry using `renderToReadableStream` (Web Streams) instead of
// the default `renderToPipeableStream` (Node streams). bun's react-dom server
// build (server.bun.js) does not export renderToPipeableStream, so the default
// entry fails to build/prerender under bun on Linux. Web streams work on bun.
import { renderToReadableStream } from 'react-dom/server'
import { type EntryContext, ServerRouter } from 'react-router'

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  let statusCode = responseStatusCode
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error: unknown) {
        statusCode = 500
        console.error(error)
      },
    },
  )

  responseHeaders.set('Content-Type', 'text/html')
  return new Response(body, { status: statusCode, headers: responseHeaders })
}
