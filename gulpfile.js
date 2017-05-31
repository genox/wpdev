var spawn = require('child_process').spawnSync,
  spawnConfig = {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8'
  },
  requirementsError = 0,
  gulp = require('gulp'),
  rtlcss = require('gulp-rtlcss'),
  autoprefixer = require('gulp-autoprefixer'),
  plumber = require('gulp-plumber'),
  gutil = require('gulp-util'),
  rename = require('gulp-rename'),
  concat = require('gulp-concat'),
  jshint = require('gulp-jshint'),
  uglify = require('gulp-uglify'),
  imagemin = require('gulp-imagemin'),
  browserSync = require('browser-sync').create(),
  bump = require('gulp-bump'),
  replace = require('gulp-string-replace'),
  reload = browserSync.reload,
  runSequence = require('run-sequence'),
  sass = require('gulp-sass'),
  fs = require('fs');

try {
  fs.statSync('./wpdev.config.json');
} catch (e) {
  gutil.log('wpdev.config.json not found. Exiting.')
}

const config = require('./wpdev.config.json');
const rsyncLocation = config.deploy.remote.sshuser + '@' + config.deploy.remote.sshserver + ':' + config.deploy.remote.basepath + '/';
const sshLogin = config.deploy.remote.sshuser + '@' + config.deploy.remote.sshserver;

if (config.proxytarget == 'http://localdomain.dev/') {
  gutil.log('Looks like wpdev.config.json does not contain valid config. Please customise the config with proper data to use wpdev.');
  process.exit();
}

var onError = function(err) {
  console.log('An error occurred:', gutil.colors.magenta(err.message));
  gutil.beep();
  this.emit('end');
  process.exit();
};


// establish working configuration and requirements

require('dns').lookupService('8.8.8.8', 53, function(err, hostname, service) {
  if (err) {
    gutil.log('Internet not reachable. Exiting..');
    process.exit();
  }
});

var testExecutables = ['php', 'rsync', 'ssh', 'scp'];
var testFiles = ['backup', config.wppath, config.wppath + '/wp-config.php', config.wppath + '/wp-config.live.php', config.wppath + '/wp-config.dev.php', config.wppath + '/wp-cli.phar', config.wppath + '/wp-content', config.wppath + '/wp-content/themes', config.themepath];

for (var i = 0, len = testExecutables.length; i < len; i++) {
  try {
    let stdout = spawn('which', [testExecutables[i]], spawnConfig).stdout;
    if (!stdout) {
      throw (testExecutables[i] + ' not found in PATH. Exiting..')
    }
  } catch (e) {
    gutil.log(e);
    requirementsError++;
  }
}

for (var i = 0, len = testFiles.length; i < len; i++) {
  try {
    fs.statSync(process.cwd() + '/' + testFiles[i]);
  } catch (e) {
    if (testFiles[i] == config.wppath + 'wp-cli.phar') {
      gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Downloading now..');
      spawn('curl', ['-o', config.wppath + '/wp-cli.phar', 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar'], spawnConfig);
    } else if (testFiles[i] == config.themepath) {
      gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Creating now..');
      spawn('mkdir', [config.wppath + '/wp-content'], spawnConfig);
      spawn('mkdir', [config.wppath + '/wp-content/themes'], spawnConfig);
      spawn('mkdir', [config.themepath], spawnConfig);
    } else if (testFiles[i] == 'backup') {
      gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Creating now..');
      spawn('mkdir', ['backup'], spawnConfig);
    } else {
      gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Exiting.');
      requirementsError++;
    }
  }
}

let cmd = 'if [ -f ' + config.deploy.remote.basepath + '/wp-cli.phar ]; then echo exists; else echo missing; fi'
let remoteWpCliTest = spawn('ssh', [sshLogin, cmd], spawnConfig);
if (remoteWpCliTest.stdout.indexOf('exists') < 0) {
  gutil.log('Remote wp-cli missing. Uploading now..');
  spawn('rsync', ['-avz', config.wppath + '/wp-cli.phar', rsyncLocation], spawnConfig);
}

// if a requirement fails, we exit here before causing any disturbances in the force..
if (requirementsError > 0) {
  process.exit();
}


// WP CLI: install or update to localhost, push to remote

gulp.task('underscore-install', function() {
  spawn('curl', ['-O', 'https://github.com/Automattic/_s/archive/master.zip'], spawnConfig);
  spawn('unzip', ['-f', 'master.zip', '\'_s-master/*\'', config.themepath], spawnConfig);
  spawn('rm', ['-f', 'master.zip'], spawnConfig);
});

gulp.task('wp-cli-install', function() {
  spawn('curl', ['-o', config.wppath + '/wp-cli.phar', 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar'], spawnConfig);
  spawn('rsync', ['-avz', config.wppath + '/wp-cli.phar', rsyncLocation], spawnConfig);
});

gulp.task('install-wp', function() {
  spawn('mkdir', ['www'], spawnConfig);
  gutil.log(spawn('php', [config.wppath + '/wp-cli.phar', '--path=' + config.wppath, 'core', 'download'], spawnConfig).output);
});

// project setup

gulp.task('version-bump', function() {
  return gulp.src('./wpdev.config.json')
    .pipe(bump())
    .pipe(gulp.dest('./'));
});

gulp.task('prepare-scss', function() {
  return gulp.src([config.themepath + '/sass/style.scss'])
    .pipe(replace('Theme Name: _s', 'Theme Name: %%name%%'))
    .pipe(replace('Author: Automattic', 'Author: %%author%%'))
    .pipe(replace('Version: 1.0.0', 'Version: %%version%%'))
    .pipe(replace('Author URI: http://automattic.com/', 'Author URI: %%uri%'))
    .pipe(replace('Theme URI: http://underscores.me/', 'Theme URI: %%uri%'))
    .pipe(replace("Description: Hi. I'm a starter theme called <code>_s</code>, or <em>underscores</em>, if you like. I'm a theme meant for hacking so don't use me as a <em>Parent Theme</em>. Instead try turning me into the next, most awesome, WordPress theme out there. That's what I'm here for.", 'Description: %%description%%'))
    .pipe(gulp.dest(config.themepath + '/sass'));
});

gulp.task('populate-css', function() {
  var cf = require('./wpdev.config.json');
  return gulp.src(config.themepath + '/*.css')
    .pipe(replace('%%version%%', cf.version))
    .pipe(replace('%%name%%', cf.name))
    .pipe(replace('%%author%%', cf.author))
    .pipe(replace('%%uri%%', cf.uri))
    .pipe(replace('%%description%%', cf.description))
    .pipe(gulp.dest('./'));
});

// Sass
gulp.task('sass', function() {
  return gulp.src(config.themepath + '/sass/**/*.scss')
    .pipe(plumber({
      errorHandler: onError
    }))
    .pipe(sass().on('error', sass.logError))
    .pipe(autoprefixer())
    .pipe(gulp.dest(config.themepath))
    .pipe(rtlcss())
    .pipe(rename({
      basename: 'rtl'
    }))
    .pipe(gulp.dest(config.themepath));
});

// JavaScript
gulp.task('js', function() {
  return gulp.src([config.themepath + '/js/*.js'])
    .pipe(jshint())
    .pipe(jshint.reporter('default'))
    .pipe(concat('app.js'))
    .pipe(rename({
      suffix: '.min'
    }))
    .pipe(uglify())
    .pipe(gulp.dest(config.themepath));
});

gulp.task('js-libraries', function() {
  var cf = require('./wpdev.config.json');
  return gulp.src(cf.jslibs)
    .pipe(jshint())
    .pipe(jshint.reporter('default'))
    .pipe(concat('lib.js'))
    .pipe(rename({
      suffix: '.min'
    }))
    .pipe(uglify())
    .pipe(gulp.dest(config.themepath));
});

// Images
gulp.task('images', function() {
  return gulp.src(config.themepath + '/images/src/*')
    .pipe(plumber({
      errorHandler: onError
    }))
    .pipe(imagemin({
      optimizationLevel: 7,
      progressive: true
    }))
    .pipe(gulp.dest(config.themepath + '/images/dist'));
});

// Watch
gulp.task('browsersync', function() {
  browserSync.init({
    files: [config.themepath + '/**/*.php'],
    proxy: config.proxytarget,
  });
  gulp.watch(config.themepath + '/sass/**/*.scss', ['sass', 'version-bump', 'populate-css', reload]);
  gulp.watch(config.themepath + '/js/*.js', ['js', reload]);
  gulp.watch(config.themepath + '/images/src/*', ['images', reload]);
});

gulp.task('files-push', function() {

  spawn('cp', [
    '-f',
    config.wppath + '/wp-config.php',
    config.wppath + '/wp-config.dev.php'
  ], spawnConfig);

  spawn('cp', [
    '-f',
    config.wppath + '/wp-config.live.php',
    config.wppath + '/wp-config.php'
  ], spawnConfig);

  let rsync = spawn('rsync', [
    '-avz',
    '--exclude-from=' + process.cwd() + '/' + config.deploy.excludes,
    config.wppath + '/',
    rsyncLocation,
    '--delete-before'
  ], spawnConfig);
  gutil.log(rsync.stdout);

  spawn('cp', [
    '-f',
    config.wppath + '/wp-config.dev.php',
    config.wppath + '/wp-config.php'
  ], spawnConfig);

  return rsync;
});

gulp.task('files-pull', function() {
  let rsync = spawn('rsync', [
    '-avz',
    '--exclude-from=' + process.cwd() + '/' + config.deploy.excludes,
    rsyncLocation,
    config.wppath + '/'
  ], spawnConfig);
  gutil.log(rsync.stdout);

  spawn('cp', [
    '-f',
    config.wppath + '/wp-config.dev.php',
    config.wppath + '/wp-config.php'
  ], spawnConfig);

  return rsync;
});

gulp.task('db-push', function() {
  let cmd;
  //wp db export --add-drop-table + sed search and replace would not need migratedb but could be shaky
  gutil.log(spawn('php', [config.wppath + '/wp-cli.phar', '--path=' + config.wppath, 'migratedb', 'export', 'database.sql',
    '--find=' + config.deploy.dbreplace.dev,
    '--replace=' + config.deploy.dbreplace.prod,
  ], spawnConfig).output);
  gutil.log(spawn('rsync', ['-avz', 'database.sql', rsyncLocation], spawnConfig).stdout);
  cmd = 'cd ' + config.deploy.remote.basepath + '; php wp-cli.phar db import database.sql';
  gutil.log(spawn('ssh', [sshLogin, cmd], spawnConfig).stdout);
  gutil.log(spawn('zip', ['-rm', '-9', './backup/database.zip', 'database.sql'], spawnConfig).stdout);
  cmd = 'rm ' + config.deploy.remote.basepath + '/database.sql';
  gutil.log(spawn('ssh', [sshLogin, cmd], spawnConfig).stdout);
});

gulp.task('db-pull', function() {
  let cmd;
  cmd = 'cd ' + config.deploy.remote.basepath + '; php wp-cli.phar migratedb export database.sql --find=' + config.deploy.dbreplace.prod + ' --replace=' + config.deploy.dbreplace.dev;
  gutil.log(spawn('ssh', [sshLogin, cmd], spawnConfig).stdout);
  gutil.log(spawn('rsync', ['-avz', rsyncLocation + 'database.sql', '.'], spawnConfig).stdout);
  gutil.log(spawn('php', [config.wppath + '/wp-cli.phar', '--path=' + config.wppath, 'db', 'import', 'database.sql'], spawnConfig).stdout);
  gutil.log(spawn('zip', ['-rm', '-9', './backup/database.zip', 'database.sql'], spawnConfig).stdout);
  cmd = 'rm ' + config.deploy.remote.basepath + '/database.sql';
  gutil.log(spawn('ssh', [sshLogin, cmd], spawnConfig).stdout);
});

gulp.task('pull', function() {
  runSequence('files-pull', 'db-pull');
});

gulp.task('push', function() {
  runSequence('files-push', 'db-push');
});

gulp.task('build', function() {
  runSequence('prepare-scss', 'sass', 'js', 'js-libraries', 'images', 'version-bump', 'populate-css');
});

gulp.task('watch', function() {
  runSequence('prepare-scss', 'sass', 'js', 'js-libraries', 'images', 'version-bump', 'populate-css', 'browsersync');
});

gulp.task('default', ['watch']);
