# WPDEV

A collection of gulp tasks to manage a WordPress instance with underscores theme, minification and browsersync. Also allows to push/pull files and database dumps from a remote server to the local dev instance.

Disclaimer: This repository is not supported, use on your own risk. This is a heavily customized approach, not generic and requires you know your way around gulp, wordpress and so on. But maybe someone can base their own approach on this (who knows). These gulp tasks will overwrite and delete files, as well as drop tables on importing SQL dumps. You've been warned!

For the brave ones, here's a quick guide:

## Setup and usage

1. `git clone https://github.com/genox/wpdev.git`
2. `npm install`
3. `cp wpdev.config.default.json wpdev.config.json`
4. Edit wpdev.config.json
5. `gulp wp-install` will download wp-cli.phar and extract the latest WordPress release to the www directory. Gulp will scan for required binaries in your PATH and mention everything that's missing and create directories, downloading whatever's necessary.
6. Create a DB for your local WP install
7. Create wp-config.dev.php and wp-config.prod.php and edit them accordingly
8. `gulp underscore-install` will download the latest version from Automattic's github repo and place it in wp-content/themes, renaming the folder according to what you defined in the config.
9. Now see if your local WP instance purrs, activate your theme and install the plugin `migratedb`

* The default gulp tasks will start a watcher and open the local dev instance via browsersync proxytarget in your browser.
* Your theme's style.css (containing theme meta data) will be populated based on info found in wpdev.config.json.
* The theme version (0.0.x) is increased with each browsersync reload to make sure all CSS and JS resources are reloaded when pushing the data to prod

## Basics

`gulp push`
..pushes files in wwwto prod and imports the SQL dump exported on localhost while replacing the strings defined in wpdev.config.json. *All files that aren't on the remote server will be deleted*.

`gulp pull`
..does the opposite. No files will be deleted on localhost.

There's plenty of tasks to explore in gulpfile.js.

*Note:* For local development, I use PHP7.x, Apache 2.4, MySQL and dnsmasq via `brew` on MacOS as services. Apache dynamically parses all .dev domains to dynamic virtualHost directories in my project folder. I found that NGINX with PHP-FCGI causes strange exceptions especially with WordPress and also does not reflect the productive server environments of most webhosting solutions.
