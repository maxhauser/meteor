Package.describe({
  summary: 'A server side rendering solution'
})

Package.on_use(function(api) {
    api.use(['underscore', 'deps', 'uuid', 'domutils', 'universal-events'])
    api.add_files('hotshot.js', 'server')
    api.add_files('renderer.js', ['server', 'client'])
    api.add_files('router.js', 'client')
})

var re = /<template\s+name="([^"]+)">([\s\S]*?)<\/template>/gm
var dot = require('dot')

dot.templateSettings = {
  evaluate:    /\{\{([\s\S]+?)\}\}/g,
  interpolate: /\{\{=([\s\S]+?)\}\}/g,
  encode:      /\{\{!([\s\S]+?)\}\}/g,
  use:         /\{\{#([\s\S]+?)\}\}/g,
  define:      /\{\{##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\}\}/g,
  conditional: /\{\{\?(\?)?\s*([\s\S]*?)\s*\}\}/g,
  iterate:     /\{\{~\s*(?:\}\}|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\})/g,
  varname: 'it',
  strip: true,
  append: true,
  selfcontained: true
}

var fs = require('fs')
Package.register_extension('html', function(bundle, source_path, serve_path, where) {
    serve_path = serve_path + '.js'

    var content = fs.readFileSync(source_path).toString()
    var script = 'var t = Hotshot.Template, ts = Hotshot.Templates, p;'
    var match

    while((match = re.exec(content.toString()))) {
        var name = match[1]
        var template = match[2]
        var fn = dot.template(template)

        script +=
          'ts.' + name + ' = function ' + name + '(config) { this.init(config) };' +
          '_.extend(ts.' + name + '.prototype, t);' +
          'ts.' + name + '.prototype.renderTemplate = ' + fn.toString() + ';'
    }

    bundle.add_resource({
        type: 'js',
        path: serve_path,
        data: new Buffer(script),
        where: where})
})