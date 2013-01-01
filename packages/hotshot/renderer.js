if(!Meteor.Hotshot)
    Meteor.Hotshot = {}

var Hotshot = Meteor.Hotshot

if(!Hotshot.Templates)
    Hotshot.Templates = {}

Emitter = function() {
   this.out = {js: ''}
}

_.extend(Emitter.prototype, {
    js: function(js) {
        this.out.js += js
    },
    render: function(fn, scope) {
        scope = scope || this
        return fn.call(scope, this)
    }
})

Hotshot.render = function(renderFn, scope) {
    if(!Emitter.Current) {
        var emitter = new Emitter
        Emitter.Current = emitter
        try {
            return _.extend({html: emitter.render(renderFn, scope)}, emitter.out)
        } finally {
            Emitter.Current = null
        }
    } else {
        var emitter = Emitter.Current;
        return _.extend({html: emitter.render(renderFn, scope)}, emitter.out)
    }
}

Hotshot.renderControl = function(Control) {
    var control = Control
    if('function' === typeof Control)
        control = new Control
    return Hotshot.render(control.render, control)
}

Hotshot.Template = {
    init: function(config) {
        this.listeners = []
        this.config = config || {}
        if(!this.config.id)
            this.config.id = Meteor.uuid()
    },
    template: function(name) {
        return Meteor.Hotshot.renderControl(Meteor.Hotshot.Templates[name]).html
    },
    render: function(emit) {
        var self = this
        emit.js('new ' + this.getClassName() + '(' + JSON.stringify(this.config) + ').bind();')

        var ctx = new Meteor.deps.Context, out
        ctx.run(function() {
            out = self.renderTemplate(self)
        })
        ctx.onInvalidate(function() {
            self.onInvalidate()
        })
        return out
    },
    getClassName: function() {
        return 'Meteor.Hotshot.Templates.' + this.constructor.name
    },
    bind: function() {
        var emptyFn = function(){}
        var dummyEmitter = {html: emptyFn, js: emptyFn} 

        this.render(dummyEmitter)
        this.setupEvents()
    },
    setupEvents: function() {
        var self = this
        var events = this.events
        if(!events)
            return

        _.each(this.listeners, function(listener) {
            listener.destroy()
        })
        this.listeners = []

        var el = self.getElement()

        _.each(events, function(handler, eventselector) {
            var comps = eventselector.split(' ', 2) 
            var type = comps[0]
            var selector = comps[1]
            var listener = new UniversalEventListener(function(ev) {
                if(ev.currentTarget === document)
                    return
                if(DomUtils.matchesSelector(ev.currentTarget, el, selector)) {
                    ev.stopPropagation()
                    return handler.apply(self, arguments)
                }
            })
            listener.addType(type)
            self.listeners.push(listener)
        })
    },
    getElement: function() {
        return document.getElementById(this.config.id)
    },
    onInvalidate: function() {
        //console.log('INVALIDATE', this.getClassName(), this.config.id)
        var self = this
        var el = self.getElement()
        if(!el) {
            this.destroy()
            return
        }

        var out = Hotshot.render(self.render, self)

        var dom = document.createElement('div')
        dom.innerHTML = out.html

        // get first non text node
        var firstChild = _.find(dom.childNodes, function(nd) { return nd.nodeType !== 3 })
        el.parentNode.replaceChild(firstChild, el)

        if(Meteor.isClient) {
            var j = $(firstChild)
            j.attr('style', 'background-color: yellow')
            Meteor.setTimeout(function() { j.attr('style', null) }, 300)
        }

        self.setupEvents()
    },
    destroy: function() {
        //console.log('destroy', this.getClassName(), ':', this.config.id)
        _.each(this.listeners, function(listener) {
            listener.destroy()
        })
        this.listeners = []
    }
}

Hotshot.Templates.Main = {
    render: function() { return '<h3>Replace main template</h3>' }
}
