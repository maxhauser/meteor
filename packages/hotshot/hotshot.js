;(function() {
    'use strict';

    if(!Meteor.Hotshot)
        Meteor.Hotshot = {}

    var Hotshot = Meteor.Hotshot

    var app = __meteor_bootstrap__.app
    app.use(function(req, res, next) {
        Fiber(function() {
            Hotshot.Router = {
                getPath: function() {
                    return req.url
                }
            }
            var write = res.write;
            var out = Hotshot.renderControl(Hotshot.Templates.Main)
            var re = '<!-- ##BODY_CONTENT## -->'
            var re2 = '</body>'
            var script = '<script>' + out.js + '</script>'
            res.write = function(text) {
                text = text.replace(re, out.html).replace(re2, script + re2)
                write.call(res, text)
            }
            next()
        }).run()
    })
}())