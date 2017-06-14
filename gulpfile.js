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

if (process.argv[2]) {
  var calledTask = process.argv[2];
} else {
  var calledTask = 'default';
}

const CONFIG_FILE = './wpdev.config.json';

try {
  fs.statSync(CONFIG_FILE);
} catch (e) {
  gutil.log(CONFIG_FILE, 'not found. Exiting.');
}

const CFG = require(CONFIG_FILE);
const RSYNC_LOCATION = CFG.deploy.remote.sshuser + '@' + CFG.deploy.remote.sshserver + ':' + CFG.deploy.remote.basepath + '/';
const SSH_LOGIN = CFG.deploy.remote.sshuser + '@' + CFG.deploy.remote.sshserver;
const WP_PATH = CFG.directories.wordpress;
const WP_THEMES_PATH = WP_PATH + '/wp-content/themes';
const MY_THEME_PATH = WP_THEMES_PATH + '/' + CFG.directories.theme;

const WP_CONFIG = WP_PATH + '/wp-config.php';
const WP_CONFIG_PROD = WP_PATH + '/wp-config.prod.php';
const WP_CONFIG_DEV = WP_PATH + '/wp-config.dev.php';

const WP_HTACCESS = WP_PATH + '/.htaccess';
const WP_HTACCESS_DEV = WP_PATH + '/.htaccess.dev';
const WP_HTACCESS_PROD = WP_PATH + '/.htaccess.prod';

const WP_UNDERSCORE_DOWNLOAD_URI = 'https://github.com/Automattic/_s/archive/master.zip';

const WP_CLI_DOWNLOAD_URI = 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';
const WP_CLI = WP_PATH + '/wp-cli.phar';

const RSYNC_BIN = 'rsync';
const PHP_BIN = 'php';
const CURL_BIN = 'curl';

const PROD_WP_CLI = CFG.deploy.remote.basepath + '/wp-cli.phar';

// Helpers

var exitIfFileExists = function(f) {
  try {
    if (fs.statSync(f)) {
      throw f + ' exists already, exiting.';
    } else {
      return f;
    }
  } catch (e) {
    gutil.log(e)
    process.exit();
  }
};

var exitIfFileMissing = function(f) {
  try {
    if (!fs.statSync(f)) {
      throw f + ' exists already, exiting.';
    } else {
      return f;
    }
  } catch (e) {
    gutil.log(e)
    process.exit();
  }
};


if (CFG.proxytarget == 'http://localdomain.dev/') {
  gutil.log('Looks like wpdev.CFG.json does not contain valid CFG. Please customise the config with proper data to use wpdev.');
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

// Extended testing excludes various tasks (downloading initial wordpress install etc)
if (!calledTask.match(/(wp-install|wp-config-copy|htaccess-copy|underscore-install)/)) {
  var testExecutables = [CURL_BIN, PHP_BIN, RSYNC_BIN, 'ssh', 'scp'];
  var testFiles = [MY_THEME_PATH, 'backup', WP_PATH, WP_CONFIG, WP_CONFIG_PROD, WP_CONFIG_DEV, WP_CLI, WP_PATH + '/wp-content', WP_PATH + '/wp-content/themes'];

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
      if (testFiles[i] == WP_CLI) {
        gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Downloading now..');
        spawn(CURL_BIN, ['-o', WP_CLI, WP_CLI_DOWNLOAD_URI], spawnConfig);
      } else if (testFiles[i] == 'backup') {
        gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Creating now..');
        spawn('mkdir', ['backup'], spawnConfig);
      } else {
        gutil.log(testFiles[i] + ' not found in ' + process.cwd() + '. Exiting.');
        requirementsError++;
      }
    }
  }

  let cmd = 'if [ -f ' + PROD_WP_CLI + ' ]; then echo exists; else echo missing; fi'
  let remoteWpCliTest = spawn('ssh', [SSH_LOGIN, cmd], spawnConfig);
  if (remoteWpCliTest.stdout.indexOf('exists') < 0) {
    gutil.log('Remote wp-cli missing. Uploading now..');
    spawn(RSYNC_BIN, ['-avz', WP_CLI, RSYNC_LOCATION], spawnConfig);
  }

  // if a requirement fails, we exit here before causing any disturbances in the force..
  if (requirementsError > 0) {
    process.exit();
  }
}

// Download and install WP, _s and WP-CLI
// these tasks are excluded from the testing done above

gulp.task('underscore-install-files', function() {
  try {
    if (!fs.statSync(MY_THEME_PATH)) {
      throw 'MY_THEME_PATH not found.'
    } else {
      gutil.log(spawn('rm', ['-rf', MY_THEME_PATH], spawnConfig).stdout);
    }
  } catch (e) {
    gutil.log('Theme directory does not exist.')
  }
  gutil.log(spawn(CURL_BIN, ['-Lko', 'tmp.zip', WP_UNDERSCORE_DOWNLOAD_URI], spawnConfig).stderr);
  gutil.log(spawn('unzip', ['tmp.zip', '-d', MY_THEME_PATH], spawnConfig).stdout);
  gutil.log(spawn('mv', [MY_THEME_PATH + '/_s-master', MY_THEME_PATH, ], spawnConfig).stdout);
  gutil.log(spawn('rm', ['-f', 'tmp.zip'], spawnConfig).stdout);
});

gulp.task('wp-cli-install', function() {
  spawn(CURL_BIN, ['-o', WP_CLI, WP_CLI_DOWNLOAD_URI], spawnConfig);
  spawn(RSYNC_BIN, ['-avz', WP_CLI, RSYNC_LOCATION], spawnConfig);
});

gulp.task('wp-install', function() {
  gutil.log(spawn('mkdir', [WP_PATH], spawnConfig).stdout);
  gutil.log(spawn(CURL_BIN, ['-LOk', WP_CLI_DOWNLOAD_URI], spawnConfig).stderr);
  gutil.log(spawn('mv', ['wp-cli.phar', WP_PATH + '/'], spawnConfig).stdout);
  gutil.log(spawn(PHP_BIN, [WP_CLI, '--path=' + WP_PATH, 'core', 'download'], spawnConfig).stdout);
});


// WP dev/prod setup

gulp.task('wp-config-copy', function() {
  return gulp.src(exitIfFileMissing(WP_CONFIG))
    .pipe(gulp.dest(exitIfFileExists(WP_CONFIG_PROD)))
    .pipe(gulp.dest(exitIfFileExists(WP_CONFIG_DEV)));
});
gulp.task('htaccess-copy', function() {
  return gulp.src(WP_HTACCESS)
    .pipe(gulp.dest(WP_HTACCESS_PROD))
    .pipe(gulp.dest(WP_HTACCESS_DEV));
});


// Theme setup

gulp.task('version-bump', function() {
  return gulp.src(CONFIG_FILE)
    .pipe(bump())
    .pipe(gulp.dest('./'));
});

gulp.task('prepare-sass', function() {
  return gulp.src(['./sass/style.scss'], {
      cwd: MY_THEME_PATH
    })
    .pipe(replace('Theme Name: _s', 'Theme Name: %%name%%'))
    .pipe(replace('Author: Automattic', 'Author: %%author%%'))
    .pipe(replace('Version: 1.0.0', 'Version: %%version%%'))
    .pipe(replace('Author URI: http://automattic.com/', 'Author URI: %%uri%%'))
    .pipe(replace('Theme URI: http://underscores.me/', 'Theme URI: %%uri%%'))
    .pipe(replace("Description: Hi. I'm a starter theme called <code>_s</code>, or <em>underscores</em>, if you like. I'm a theme meant for hacking so don't use me as a <em>Parent Theme</em>. Instead try turning me into the next, most awesome, WordPress theme out there. That's what I'm here for.", 'Description: %%description%%'))
    .pipe(gulp.dest('./sass', {
      cwd: MY_THEME_PATH
    }));
});

gulp.task('populate-css', function() {
  var cf = require(CONFIG_FILE);
  console.log(cf);
  return gulp.src('./*.css', {
      cwd: MY_THEME_PATH
    })
    .pipe(replace('%%version%%', cf.theme.version))
    .pipe(replace('%%name%%', cf.theme.name))
    .pipe(replace('%%author%%', cf.author))
    .pipe(replace('%%uri%%', cf.theme.uri))
    .pipe(replace('%%description%%', cf.theme.description))
    .pipe(gulp.dest('./', {
      cwd: MY_THEME_PATH
    }));
});

// Sass
gulp.task('compile-sass', function() {
  return gulp.src('./sass/**/*.scss', {
      cwd: MY_THEME_PATH
    })
    .pipe(plumber({
      errorHandler: onError
    }))
    .pipe(sass().on('error', sass.logError))
    .pipe(autoprefixer())
    .pipe(gulp.dest('./', {
      cwd: MY_THEME_PATH
    }))
    .pipe(rtlcss())
    .pipe(rename({
      basename: 'rtl'
    }))
    .pipe(gulp.dest('./', {
      cwd: MY_THEME_PATH
    }));
});

// JavaScript
gulp.task('js', function() {
  return gulp.src(['./js/*.js'], {
      cwd: MY_THEME_PATH
    })
    .pipe(jshint())
    .pipe(jshint.reporter('default'))
    .pipe(concat('app.js'))
    .pipe(rename({
      suffix: '.min'
    }))
    .pipe(uglify())
    .pipe(gulp.dest('./', {
      cwd: MY_THEME_PATH
    }));
});

gulp.task('js-libraries', function() {
  var cf = require(CONFIG_FILE);
  gutil.log(cf.theme.jslibs);
  return gulp.src(cf.theme.jslibs)
    .pipe(concat('lib.min.js'))
    .pipe(uglify())
    .pipe(gulp.dest('./', {
      cwd: MY_THEME_PATH
    }));
});

// Images
gulp.task('images', function() {
  return gulp.src('./images/src/*', {
      cwd: MY_THEME_PATH
    })
    .pipe(plumber({
      errorHandler: onError
    }))
    .pipe(imagemin({
      optimizationLevel: 7,
      progressive: true
    }))
    .pipe(gulp.dest('./images/dist', {
      cwd: MY_THEME_PATH
    }));
});

// Watch
gulp.task('browsersync', function() {
  browserSync.init({
    files: [MY_THEME_PATH + '/**/*.php'],
    proxy: CFG.proxytarget,
  });
  gulp.watch(MY_THEME_PATH + '/sass/**/*.scss', ['compile-sass', 'version-bump', 'populate-css', reload]);
  gulp.watch(MY_THEME_PATH + '/js/*.js', ['js', reload]);
  gulp.watch(MY_THEME_PATH + '/images/src/*', ['images', reload]);
});

gulp.task('files-push', function() {

  spawn('cp', ['-f', WP_CONFIG, WP_CONFIG_DEV], spawnConfig);
  spawn('cp', ['-f', WP_CONFIG_PROD, WP_CONFIG], spawnConfig);

  spawn('cp', ['-f', WP_HTACCESS, WP_HTACCESS_DEV], spawnConfig);
  spawn('cp', ['-f', WP_HTACCESS_PROD, WP_HTACCESS], spawnConfig);

  let rsync = spawn(RSYNC_BIN, [
    '-avz',
    '--exclude-from=' + process.cwd() + '/' + CFG.deploy.excludes,
    WP_PATH + '/',
    RSYNC_LOCATION,
    '--delete-before'
  ], spawnConfig);
  gutil.log(rsync.stdout);

  spawn('cp', ['-f', WP_CONFIG_DEV, WP_CONFIG], spawnConfig);
  spawn('cp', ['-f', WP_HTACCESS_DEV, WP_HTACCESS], spawnConfig);

  return rsync;
});

gulp.task('files-pull', function() {
  let rsync = spawn(RSYNC_BIN, [
    '-avz',
    '--exclude-from=' + process.cwd() + '/' + CFG.deploy.excludes,
    RSYNC_LOCATION,
    WP_PATH + '/'
  ], spawnConfig);
  gutil.log(rsync.stdout);

  spawn('cp', ['-f', WP_CONFIG_DEV, WP_CONFIG], spawnConfig);
  spawn('cp', ['-f', WP_HTACCESS_DEV, WP_HTACCESS], spawnConfig);

  return rsync;
});

gulp.task('db-push', function() {
  let cmd;
  //wp db export --add-drop-table + sed search and replace would not need migratedb but could be shaky
  gutil.log(spawn(PHP_BIN, [WP_CLI, '--path=' + WP_PATH, 'migratedb', 'export', 'database.sql',
    '--find=' + CFG.deploy.dbreplace.dev,
    '--replace=' + CFG.deploy.dbreplace.prod,
  ], spawnConfig).output);
  gutil.log(spawn(RSYNC_BIN, ['-avz', 'database.sql', RSYNC_LOCATION], spawnConfig).stdout);
  cmd = 'cd ' + CFG.deploy.remote.basepath + '; php wp-cli.phar db import database.sql';
  gutil.log(spawn('ssh', [SSH_LOGIN, cmd], spawnConfig).stdout);
  gutil.log(spawn('zip', ['-rm', '-9', './backup/database.zip', 'database.sql'], spawnConfig).stdout);
  cmd = 'rm ' + CFG.deploy.remote.basepath + '/database.sql';
  gutil.log(spawn('ssh', [SSH_LOGIN, cmd], spawnConfig).stdout);
});

gulp.task('db-pull', function() {
  let cmd;
  cmd = 'cd ' + CFG.deploy.remote.basepath + '; php wp-cli.phar migratedb export database.sql --find=' + CFG.deploy.dbreplace.prod + ' --replace=' + CFG.deploy.dbreplace.dev;
  gutil.log(spawn('ssh', [SSH_LOGIN, cmd], spawnConfig).stdout);
  gutil.log(spawn(RSYNC_BIN, ['-avz', RSYNC_LOCATION + 'database.sql', '.'], spawnConfig).stdout);
  gutil.log(spawn(PHP_BIN, [WP_CLI, '--path=' + WP_PATH, 'db', 'import', 'database.sql'], spawnConfig).stdout);
  gutil.log(spawn('zip', ['-rm', '-9', './backup/database.zip', 'database.sql'], spawnConfig).stdout);
  cmd = 'rm ' + CFG.deploy.remote.basepath + '/database.sql';
  gutil.log(spawn('ssh', [SSH_LOGIN, cmd], spawnConfig).stdout);
});

gulp.task('pull', function() {
  runSequence('files-pull', 'db-pull');
});

gulp.task('push', function() {
  runSequence('files-push', 'db-push');
});

gulp.task('underscore-install', function() {
  runSequence('underscore-install-files', 'prepare-sass', 'compile-sass', 'populate-css');
});

gulp.task('sass', function() {
  runSequence('prepare-sass', 'compile-sass', 'populate-css');
});

gulp.task('build', function() {
  runSequence('prepare-sass', 'compile-sass', 'js', 'js-libraries', 'images', 'version-bump', 'populate-css');
});

gulp.task('watch', function() {
  runSequence('prepare-sass', 'compile-sass', 'js', 'js-libraries', 'images', 'version-bump', 'populate-css', 'browsersync');
});

gulp.task('default', ['watch']);
