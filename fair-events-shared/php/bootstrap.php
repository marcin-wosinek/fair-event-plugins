<?php
/**
 * Picks the newest bundled copy of the Fair Event Plugins shared library.
 *
 * Every Fair plugin ships its own copy of fair-events/shared, but PHP loads
 * each class once per request. Each plugin loads this file from its own
 * copy and registers that copy here; the first copy of this file to load
 * defines the class and every later copy only registers. On
 * `plugins_loaded` at priority PHP_INT_MIN the newest registered copy
 * becomes the only source of FairEventsShared\ classes. Plugins defer
 * every use of shared classes until then (see when_ready()).
 *
 * If a shared class already loaded from another copy before selection, the
 * request is marked as conflicted instead: nothing is redirected, the
 * plugins that registered here stay off for that request, and
 * administrators get a notice.
 *
 * This file is a stable protocol between plugin releases. Whichever copy
 * loads first runs for every plugin, so keep it free of shared classes and
 * translated strings, compatible with PHP 7.4, and never change the meaning
 * of an existing method or registration key. See PHP_PATTERNS.md § Shared
 * Package.
 *
 * @package FairEventsShared
 */

defined( 'WPINC' ) || die;

if ( ! class_exists( 'Fair_Events_Shared_Loader', false ) ) {

	/**
	 * Registry and selection of bundled shared-library copies.
	 */
	final class Fair_Events_Shared_Loader {

		/**
		 * Registration protocol version.
		 */
		const PROTOCOL = 1;

		/**
		 * Namespace prefix of the shared library.
		 */
		const PREFIX = 'FairEventsShared\\';

		/**
		 * Selection has not run yet.
		 */
		const STATE_PENDING = 'pending';

		/**
		 * The newest copy is the only source of shared classes.
		 */
		const STATE_SELECTED = 'selected';

		/**
		 * A shared class loaded from another copy before selection.
		 */
		const STATE_CONFLICT = 'conflict';

		/**
		 * Registered copies keyed by plugin file, in registration order.
		 *
		 * @var array<string, array{plugin_file: string, dir: string, version: string, messages: callable|null}>
		 */
		private static $packages = array();

		/**
		 * Current state.
		 *
		 * @var string
		 */
		private static $state = self::STATE_PENDING;

		/**
		 * Plugin file of the selected copy.
		 *
		 * @var string|null
		 */
		private static $selected = null;

		/**
		 * Shared symbols that loaded from another copy, symbol => file.
		 *
		 * @var array<string, string>
		 */
		private static $conflicts = array();

		/**
		 * Shared-library directories Composer loaders pointed at before
		 * selection, as package directories.
		 *
		 * @var string[]
		 */
		private static $loader_dirs = array();

		/**
		 * Whether the selection and notice hooks are registered.
		 *
		 * @var bool
		 */
		private static $hooked = false;

		/**
		 * Register a plugin's bundled copy.
		 *
		 * Keys:
		 * - `plugin_file` (string, required): the plugin's main file.
		 * - `package_dir` (string, required): the copy's directory, holding
		 *   composer.json and src/.
		 * - `messages` (callable, optional): `function ( string $id, int $count ): string`
		 *   returning the plugin's translated notice templates; see
		 *   render_notices() for the ids.
		 *
		 * @param array $args Registration.
		 * @return void
		 */
		public static function register( $args ) {
			if ( ! is_array( $args ) || empty( $args['plugin_file'] ) || empty( $args['package_dir'] ) ) {
				return;
			}

			$plugin_file = (string) $args['plugin_file'];
			$dir         = self::normalize_dir( (string) $args['package_dir'] );

			self::$packages[ $plugin_file ] = array(
				'plugin_file' => $plugin_file,
				'dir'         => $dir,
				'version'     => self::read_version( $dir ),
				'messages'    => isset( $args['messages'] ) && is_callable( $args['messages'] ) ? $args['messages'] : null,
			);

			if ( ! self::$hooked ) {
				self::$hooked = true;
				add_action( 'plugins_loaded', array( __CLASS__, 'select' ), PHP_INT_MIN );
				add_action( 'admin_notices', array( __CLASS__, 'render_notices' ) );
				add_action( 'network_admin_notices', array( __CLASS__, 'render_notices' ) );
			}

			if ( self::STATE_PENDING === self::$state ) {
				// A plugin activated after plugins_loaded registers late.
				if ( did_action( 'plugins_loaded' ) ) {
					self::select();
				}
				return;
			}

			if ( self::STATE_SELECTED === self::$state ) {
				// The late plugin's Composer loader must not serve shared
				// classes either. A newer late copy waits for the next
				// request; is_ready() keeps that plugin off until then.
				self::strip_composer_loaders();
			}
		}

		/**
		 * Run $callback once shared classes are safe to use by this plugin.
		 *
		 * Before `plugins_loaded` the callback waits for it at $priority;
		 * after it (plugin activation), it runs immediately. It never runs
		 * when is_ready() is false.
		 *
		 * @param string   $plugin_file Registered plugin file.
		 * @param callable $callback    Plugin initialization.
		 * @param int      $priority    `plugins_loaded` priority, 0 or later.
		 * @return void
		 */
		public static function when_ready( $plugin_file, $callback, $priority = 0 ) {
			$run = static function () use ( $plugin_file, $callback ) {
				if ( self::is_ready( $plugin_file ) ) {
					call_user_func( $callback );
				}
			};

			if ( did_action( 'plugins_loaded' ) ) {
				$run();
				return;
			}

			add_action( 'plugins_loaded', $run, max( 0, (int) $priority ) );
		}

		/**
		 * Whether shared classes may be used.
		 *
		 * True once the newest copy is selected. For a registered plugin
		 * file, also requires that its own copy is not newer than the
		 * selected one (a plugin activated late with a newer copy waits for
		 * the next request).
		 *
		 * @param string|null $plugin_file Registered plugin file, or null.
		 * @return bool
		 */
		public static function is_ready( $plugin_file = null ) {
			if ( self::STATE_SELECTED !== self::$state ) {
				return false;
			}
			if ( null === $plugin_file || ! isset( self::$packages[ $plugin_file ] ) ) {
				return true;
			}
			$selected = self::$packages[ self::$selected ];
			return version_compare( self::$packages[ $plugin_file ]['version'], $selected['version'], '<=' );
		}

		/**
		 * Choose the newest registered copy and make it the only source of
		 * shared classes, or record a conflict.
		 *
		 * @return void
		 */
		public static function select() {
			if ( self::STATE_PENDING !== self::$state || empty( self::$packages ) ) {
				return;
			}

			$selected = null;
			foreach ( self::$packages as $plugin_file => $package ) {
				if ( null === $selected || version_compare( $package['version'], self::$packages[ $selected ]['version'], '>' ) ) {
					$selected = $plugin_file;
				}
			}

			self::$loader_dirs = self::composer_shared_dirs();
			self::$conflicts   = self::foreign_symbols( self::$packages[ $selected ]['version'] );

			if ( ! empty( self::$conflicts ) ) {
				self::$state = self::STATE_CONFLICT;
				return;
			}

			self::$selected = $selected;
			self::$state    = self::STATE_SELECTED;
			self::strip_composer_loaders();

			$src = self::$packages[ $selected ]['dir'] . '/src/';
			spl_autoload_register(
				static function ( $class_name ) use ( $src ) {
					if ( 0 !== strncmp( $class_name, self::PREFIX, strlen( self::PREFIX ) ) ) {
						return;
					}
					$file = $src . str_replace( '\\', '/', substr( $class_name, strlen( self::PREFIX ) ) ) . '.php';
					if ( is_file( $file ) ) {
						require $file;
					}
				},
				true,
				true
			);
		}

		/**
		 * What this request selected, for notices and diagnostics.
		 *
		 * @return array{protocol: int, state: string, selected: array|null, packages: array, conflicts: array<string, string>}
		 */
		public static function report() {
			$packages = array();
			foreach ( self::$packages as $package ) {
				$packages[] = array(
					'plugin_file' => $package['plugin_file'],
					'dir'         => $package['dir'],
					'version'     => $package['version'],
				);
			}

			return array(
				'protocol'  => self::PROTOCOL,
				'state'     => self::$state,
				'selected'  => null === self::$selected ? null : array(
					'plugin_file' => self::$packages[ self::$selected ]['plugin_file'],
					'dir'         => self::$packages[ self::$selected ]['dir'],
					'version'     => self::$packages[ self::$selected ]['version'],
				),
				'packages'  => $packages,
				'conflicts' => self::$conflicts,
			);
		}

		/**
		 * Every bundled copy this request knows about: registered copies,
		 * copies Composer loaders pointed at, and copies inside active site
		 * and network plugins.
		 *
		 * @return array<int, array{dir: string, version: string, plugin_file: string|null}>
		 */
		public static function bundles() {
			$bundles = array();

			foreach ( self::$packages as $package ) {
				$bundles[ $package['dir'] ] = array(
					'dir'         => $package['dir'],
					'version'     => $package['version'],
					'plugin_file' => $package['plugin_file'],
				);
			}

			$dirs = self::$loader_dirs;
			if ( defined( 'WP_PLUGIN_DIR' ) ) {
				foreach ( self::active_plugin_files() as $basename ) {
					if ( false === strpos( $basename, '/' ) ) {
						continue;
					}
					$candidate = WP_PLUGIN_DIR . '/' . dirname( $basename ) . '/vendor/fair-events/shared';
					if ( is_file( $candidate . '/composer.json' ) ) {
						$dirs[] = self::normalize_dir( $candidate );
					}
				}
			}

			foreach ( $dirs as $dir ) {
				if ( isset( $bundles[ $dir ] ) ) {
					continue;
				}
				$bundles[ $dir ] = array(
					'dir'         => $dir,
					'version'     => self::read_version( $dir ),
					'plugin_file' => self::plugin_file_for( $dir ),
				);
			}

			return array_values( $bundles );
		}

		/**
		 * Show the conflict and outdated-copy notices to administrators who
		 * can update plugins, on the Plugins screens and Fair plugin pages.
		 *
		 * Message ids passed to the elected plugin's `messages` callable,
		 * each a sprintf template:
		 * - `conflict` (count: paused plugins): %1$s paused plugins, %2$s
		 *   plugins whose copy loaded first.
		 * - `conflict_unknown` (count: paused plugins): %1$s paused plugins.
		 * - `outdated` (count: outdated plugins): %1$s outdated plugins.
		 *
		 * @return void
		 */
		public static function render_notices() {
			if ( self::STATE_PENDING === self::$state || ! current_user_can( 'update_plugins' ) || ! self::is_notice_screen() ) {
				return;
			}

			$messages = self::elected_messages();
			if ( null === $messages ) {
				return;
			}

			$responsible = array();
			if ( self::STATE_CONFLICT === self::$state ) {
				$paused  = array();
				$unknown = false;
				foreach ( self::$packages as $package ) {
					$paused[] = self::plugin_name( $package['plugin_file'] );
				}
				foreach ( self::$conflicts as $file ) {
					$plugin_file = self::plugin_file_for( self::package_dir_of( $file ) );
					if ( null === $plugin_file ) {
						$unknown = true;
						continue;
					}
					$responsible[ $plugin_file ] = self::plugin_name( $plugin_file );
				}

				if ( empty( $responsible ) || $unknown ) {
					$text = sprintf( (string) call_user_func( $messages, 'conflict_unknown', count( $paused ) ), self::name_list( $paused ) );
				} else {
					$text = sprintf( (string) call_user_func( $messages, 'conflict', count( $paused ) ), self::name_list( $paused ), self::name_list( array_values( $responsible ) ) );
				}
				echo '<div class="notice notice-error"><p>' . esc_html( $text ) . '</p></div>';
			}

			$outdated = self::outdated_plugins();
			foreach ( array_keys( $responsible ) as $plugin_file ) {
				unset( $outdated[ $plugin_file ] );
			}
			if ( ! empty( $outdated ) ) {
				$text = sprintf( (string) call_user_func( $messages, 'outdated', count( $outdated ) ), self::name_list( array_values( $outdated ) ) );
				echo '<div class="notice notice-warning"><p>' . esc_html( $text ) . '</p></div>';
			}
		}

		/**
		 * Active plugins bundling a copy older than the one in use (or, after
		 * a conflict, older than the newest registered copy).
		 *
		 * @return array<string, string> Plugin file => plugin name, sorted by name.
		 */
		public static function outdated_plugins() {
			$current = null;
			foreach ( self::$packages as $package ) {
				if ( null === $current || version_compare( $package['version'], $current, '>' ) ) {
					$current = $package['version'];
				}
			}
			if ( null === $current ) {
				return array();
			}

			$outdated = array();
			foreach ( self::bundles() as $bundle ) {
				if ( null === $bundle['plugin_file'] || ! version_compare( $bundle['version'], $current, '<' ) ) {
					continue;
				}
				$outdated[ $bundle['plugin_file'] ] = self::plugin_name( $bundle['plugin_file'] );
			}
			asort( $outdated );
			return $outdated;
		}

		/**
		 * Shared symbols declared from outside every copy of $version.
		 *
		 * @param string $version Selected version.
		 * @return array<string, string> Symbol => file.
		 */
		private static function foreign_symbols( $version ) {
			$accepted = array();
			foreach ( self::$packages as $package ) {
				if ( version_compare( $package['version'], $version, '==' ) ) {
					$accepted[] = $package['dir'] . '/src/';
				}
			}

			$foreign = array();
			$symbols = array_merge( get_declared_classes(), get_declared_interfaces(), get_declared_traits() );
			foreach ( $symbols as $symbol ) {
				if ( 0 !== strncmp( $symbol, self::PREFIX, strlen( self::PREFIX ) ) ) {
					continue;
				}
				$reflection = new ReflectionClass( $symbol );
				$file       = $reflection->getFileName();
				if ( false === $file ) {
					continue;
				}
				$file = self::normalize_dir( $file );
				$ok   = false;
				foreach ( $accepted as $prefix ) {
					if ( 0 === strpos( $file, $prefix ) ) {
						$ok = true;
						break;
					}
				}
				if ( ! $ok ) {
					$foreign[ $symbol ] = $file;
				}
			}
			ksort( $foreign );
			return $foreign;
		}

		/**
		 * Registered Composer loaders.
		 *
		 * @return object[] Composer\Autoload\ClassLoader instances.
		 */
		private static function composer_loaders() {
			$loaders = array();
			foreach ( spl_autoload_functions() as $autoloader ) {
				if ( is_array( $autoloader ) && isset( $autoloader[0] ) && $autoloader[0] instanceof \Composer\Autoload\ClassLoader ) {
					$loaders[] = $autoloader[0];
				}
			}
			return $loaders;
		}

		/**
		 * Package directories Composer loaders map shared classes to.
		 *
		 * @return string[]
		 */
		private static function composer_shared_dirs() {
			$dirs = array();
			foreach ( self::composer_loaders() as $loader ) {
				$prefixes = $loader->getPrefixesPsr4();
				$paths    = isset( $prefixes[ self::PREFIX ] ) ? (array) $prefixes[ self::PREFIX ] : array();
				foreach ( $loader->getClassMap() as $class_name => $file ) {
					if ( 0 === strncmp( $class_name, self::PREFIX, strlen( self::PREFIX ) ) ) {
						$paths[] = self::package_dir_of( $file );
					}
				}
				foreach ( $paths as $path ) {
					$path = self::normalize_dir( $path );
					if ( '/src' === substr( $path, -4 ) ) {
						$path = substr( $path, 0, -4 );
					}
					if ( '' !== $path && is_file( $path . '/composer.json' ) ) {
						$dirs[ $path ] = $path;
					}
				}
			}
			return array_values( $dirs );
		}

		/**
		 * Remove shared PSR-4 and classmap entries from every Composer
		 * loader, keeping their other namespaces.
		 *
		 * @return void
		 */
		private static function strip_composer_loaders() {
			$loaders = self::composer_loaders();
			if ( empty( $loaders ) ) {
				return;
			}

			$prefix = self::PREFIX;
			$strip  = \Closure::bind(
				static function ( $loader ) use ( $prefix ) {
					foreach ( array_keys( $loader->classMap ) as $class_name ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Composer ClassLoader property.
						if ( 0 === strncmp( $class_name, $prefix, strlen( $prefix ) ) ) {
							unset( $loader->classMap[ $class_name ] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Composer ClassLoader property.
						}
					}
				},
				null,
				\Composer\Autoload\ClassLoader::class
			);

			foreach ( $loaders as $loader ) {
				$prefixes = $loader->getPrefixesPsr4();
				if ( ! empty( $prefixes[ self::PREFIX ] ) ) {
					$loader->setPsr4( self::PREFIX, array() );
				}
				foreach ( $loader->getClassMap() as $class_name => $file ) {
					if ( 0 === strncmp( $class_name, self::PREFIX, strlen( self::PREFIX ) ) ) {
						$strip( $loader );
						break;
					}
				}
			}
		}

		/**
		 * Messages callable of the plugin elected to word the notices: the
		 * selected copy's plugin, else the first registered one with
		 * messages.
		 *
		 * @return callable|null
		 */
		private static function elected_messages() {
			if ( null !== self::$selected && null !== self::$packages[ self::$selected ]['messages'] ) {
				return self::$packages[ self::$selected ]['messages'];
			}
			foreach ( self::$packages as $package ) {
				if ( null !== $package['messages'] ) {
					return $package['messages'];
				}
			}
			return null;
		}

		/**
		 * Whether the current screen is a Plugins screen or a Fair plugin page.
		 *
		 * @return bool
		 */
		private static function is_notice_screen() {
			$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
			if ( ! is_object( $screen ) ) {
				return false;
			}
			$id = isset( $screen->id ) ? (string) $screen->id : '';
			if ( 'plugins' === $id || 'plugins-network' === $id ) {
				return true;
			}
			if ( 1 === preg_match( '/(^|_page_)fair-/', $id ) ) {
				return true;
			}
			$post_type = isset( $screen->post_type ) ? (string) $screen->post_type : '';
			return 0 === strpos( $post_type, 'fair_' );
		}

		/**
		 * Basenames of active site and network plugins.
		 *
		 * @return string[]
		 */
		private static function active_plugin_files() {
			$active = (array) get_option( 'active_plugins', array() );
			if ( function_exists( 'is_multisite' ) && is_multisite() ) {
				$active = array_merge( $active, array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) );
			}
			return array_values( array_unique( array_filter( $active, 'is_string' ) ) );
		}

		/**
		 * Main plugin file owning a package directory (…/vendor/fair-events/shared).
		 *
		 * @param string $dir Package directory.
		 * @return string|null
		 */
		private static function plugin_file_for( $dir ) {
			foreach ( self::$packages as $package ) {
				if ( $package['dir'] === $dir ) {
					return $package['plugin_file'];
				}
			}
			if ( '' === $dir ) {
				return null;
			}
			$root  = dirname( $dir, 3 );
			$files = glob( $root . '/*.php' );
			foreach ( false === $files ? array() : $files as $file ) {
				$data = get_file_data( $file, array( 'name' => 'Plugin Name' ) );
				if ( '' !== $data['name'] ) {
					return $file;
				}
			}
			return null;
		}

		/**
		 * Package directory of a file inside a copy's src/ directory.
		 *
		 * @param string $file File.
		 * @return string Directory, or '' when the file is outside one.
		 */
		private static function package_dir_of( $file ) {
			$file = self::normalize_dir( $file );
			$pos  = strrpos( $file, '/src/' );
			if ( false === $pos ) {
				return '';
			}
			$dir = substr( $file, 0, $pos );
			return is_file( $dir . '/composer.json' ) ? $dir : '';
		}

		/**
		 * Plugin name from its header, falling back to the file name.
		 *
		 * @param string $plugin_file Plugin file.
		 * @return string
		 */
		private static function plugin_name( $plugin_file ) {
			$data = is_file( $plugin_file ) ? get_file_data( $plugin_file, array( 'name' => 'Plugin Name' ) ) : array( 'name' => '' );
			return '' !== $data['name'] ? $data['name'] : basename( $plugin_file, '.php' );
		}

		/**
		 * Localized list of names ("A, B and C").
		 *
		 * @param string[] $names Names.
		 * @return string
		 */
		private static function name_list( $names ) {
			return function_exists( 'wp_sprintf_l' ) ? wp_sprintf_l( '%l', $names ) : implode( ', ', $names );
		}

		/**
		 * Declared version of a copy, from its composer.json.
		 *
		 * @param string $dir Package directory.
		 * @return string Version, or '0' when it is missing.
		 */
		private static function read_version( $dir ) {
			$file = $dir . '/composer.json';
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local package metadata, read before WordPress filesystem APIs load.
			$json = is_file( $file ) ? file_get_contents( $file ) : false;
			$data = false === $json ? null : json_decode( $json, true );
			return is_array( $data ) && isset( $data['version'] ) && is_string( $data['version'] ) ? $data['version'] : '0';
		}

		/**
		 * Real path with forward slashes and no trailing slash.
		 *
		 * @param string $path Path.
		 * @return string
		 */
		private static function normalize_dir( $path ) {
			$real = realpath( $path );
			$path = false === $real ? $path : $real;
			return rtrim( str_replace( '\\', '/', $path ), '/' );
		}
	}
}
