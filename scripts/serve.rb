# Local preview server for the portfolio.
# Run from anywhere:  ruby ~/Documents/Sanjana_Website_Portfolio/scripts/serve.rb
# Then open http://localhost:8000. Press Ctrl+C to stop.
#
# Unlike `ruby -run -e httpd`, this tells the browser never to cache files,
# so every refresh shows your latest edits.

require 'webrick'

ROOT = File.expand_path('..', __dir__)
PORT = (ENV['PORT'] || 8000).to_i

class NoCacheFileHandler < WEBrick::HTTPServlet::FileHandler
  def do_GET(req, res)
    super
    res['Cache-Control'] = 'no-store, must-revalidate'
    res.header.delete('etag')
    res.header.delete('last-modified')
  end
end

server = WEBrick::HTTPServer.new(
  Port: PORT,
  BindAddress: '127.0.0.1',
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)
server.config[:MimeTypes]['webp'] = 'image/webp'
server.mount('/', NoCacheFileHandler, ROOT)

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts "Serving #{ROOT}"
puts "Open http://localhost:#{PORT}  (Ctrl+C to stop)"
server.start
