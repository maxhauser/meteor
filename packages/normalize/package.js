Package.describe({
    summary: 'Normalize css'
})

Package.on_use(function (api) {
  api.add_files('normalize.css', 'client');
})
