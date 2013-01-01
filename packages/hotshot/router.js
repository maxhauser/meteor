;(function() {
    'use strict';

    if(!Meteor.Hotshot)
        Meteor.Hotshot = {}

    var Hotshot = Meteor.Hotshot

    var ctxs = new Meteor.deps._ContextSet
    var pathname = window.location.pathname
    window.onpopstate = function() {
        var newpath = window.location.pathname
        if(pathname === newpath) 
            return;
        pathname = newpath
        ctxs.invalidateAll()
    }

    Hotshot.Router = {
        getPath: function() {
            ctxs.addCurrentContext()
            return pathname
        },
        setPath: function(path) {
            if(path === pathname)
                return;
            history.pushState(null, null, path)
            pathname = path
            ctxs.invalidateAll()
        }
    }
}())
