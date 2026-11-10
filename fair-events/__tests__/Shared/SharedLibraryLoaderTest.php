<?php
/**
 * Newest-wins selection of the bundled shared library (#2181).
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Shared;

use Composer\Autoload\ClassLoader;
use Fair_Events_Shared_Loader;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Each test runs in a fresh process, because a class loads once and the
 * loader keeps per-request state. Plugins are generated under a temporary
 * WP_PLUGIN_DIR, each with its own copy of the shared package and its own
 * real Composer loader, registered with prepend as Composer does. The
 * assertions read where classes actually loaded from.
 */
class SharedLibraryLoaderTest extends TestCase {

	/**
	 * Temporary plugins directory of this process.
	 *
	 * @var string
	 */
	private static $root = '';

	/**
	 * Load the loader and its stubs, and start with an empty plugins directory.
	 */
	protected function setUp(): void {
		parent::setUp();
		require_once __DIR__ . '/fixtures/shared-loader-stubs.php';
		require_once dirname( __DIR__, 2 ) . '/vendor/fair-events/shared/bootstrap.php';

		if ( '' === self::$root ) {
			self::$root = str_replace( '\\', '/', (string) realpath( sys_get_temp_dir() ) ) . '/fair-shared-loader-' . getmypid() . '-' . bin2hex( random_bytes( 4 ) );
			mkdir( self::$root, 0777, true );
		}
		if ( ! defined( 'WP_PLUGIN_DIR' ) ) {
			define( 'WP_PLUGIN_DIR', self::$root );
		}

		// The suite's own Composer loader maps the shared namespace to this
		// plugin's copy; the generated plugins stand in for it here.
		foreach ( spl_autoload_functions() as $autoloader ) {
			if ( is_array( $autoloader ) && $autoloader[0] instanceof ClassLoader ) {
				$autoloader[0]->setPsr4( 'FairEventsShared\\', array() );
			}
		}

		$GLOBALS['_fair_test_added_actions'] = array();
		$GLOBALS['_fair_test_did_action']    = array();
		$GLOBALS['_fair_test_options']       = array( 'active_plugins' => array() );
		$GLOBALS['_fair_test_caps']          = array();
		$GLOBALS['_fair_test_screen']        = null;
	}

	/**
	 * Remove the generated plugins.
	 */
	protected function tearDown(): void {
		if ( '' !== self::$root && is_dir( self::$root ) ) {
			$this->remove_tree( self::$root );
		}
		parent::tearDown();
	}

	/**
	 * Generate a plugin bundling a shared copy of $version.
	 *
	 * The copy holds LoaderProbe\Marker (reporting its version) and, when
	 * $extra is given, LoaderProbe\<extra> too.
	 *
	 * @param string      $slug    Plugin directory.
	 * @param string      $version Shared version.
	 * @param string|null $extra   Extra class only this copy has.
	 * @return string Package directory.
	 */
	private function make_plugin( string $slug, string $version, ?string $extra = null ): string {
		$plugin = self::$root . '/' . $slug;
		$dir    = $plugin . '/vendor/fair-events/shared';
		mkdir( $dir . '/src/LoaderProbe', 0777, true );
		file_put_contents( $plugin . '/' . $slug . '.php', "<?php\n/**\n * Plugin Name: " . ucwords( str_replace( '-', ' ', $slug ) ) . "\n */\n" );
		file_put_contents(
			$dir . '/composer.json',
			json_encode(
				array(
					'name'    => 'fair-events/shared',
					'version' => $version,
				)
			)
		);
		file_put_contents( $dir . '/src/LoaderProbe/Marker.php', "<?php\nnamespace FairEventsShared\\LoaderProbe;\nclass Marker { const VERSION = '" . $version . "'; }\n" );
		if ( null !== $extra ) {
			file_put_contents( $dir . '/src/LoaderProbe/' . $extra . '.php', "<?php\nnamespace FairEventsShared\\LoaderProbe;\nclass " . $extra . " {}\n" );
		}
		$GLOBALS['_fair_test_options']['active_plugins'][] = $slug . '/' . $slug . '.php';
		return $dir;
	}

	/**
	 * Register a plugin's Composer loader the way its vendor/autoload.php does.
	 *
	 * @param string $slug     Plugin directory.
	 * @param bool   $classmap Whether the build is optimized (a classmap).
	 * @return ClassLoader
	 */
	private function register_composer( string $slug, bool $classmap ): ClassLoader {
		$vendor = self::$root . '/' . $slug . '/vendor';
		$src    = $vendor . '/fair-events/shared/src';
		$loader = new ClassLoader( $vendor );
		if ( $classmap ) {
			$map = array();
			foreach ( glob( $src . '/LoaderProbe/*.php' ) as $file ) {
				$map[ 'FairEventsShared\\LoaderProbe\\' . basename( $file, '.php' ) ] = $file;
			}
			$loader->addClassMap( $map );
		} else {
			$loader->addPsr4( 'FairEventsShared\\', $src );
		}
		$loader->register( true );
		return $loader;
	}

	/**
	 * Load and register an updated plugin, as its main file does.
	 *
	 * @param string $slug     Plugin directory.
	 * @param bool   $classmap Optimized build.
	 * @return string Plugin file.
	 */
	private function load_updated( string $slug, bool $classmap = false ): string {
		$this->register_composer( $slug, $classmap );
		$file = self::$root . '/' . $slug . '/' . $slug . '.php';
		Fair_Events_Shared_Loader::register(
			array(
				'plugin_file' => $file,
				'package_dir' => self::$root . '/' . $slug . '/vendor/fair-events/shared',
				'messages'    => array( self::class, 'message' ),
			)
		);
		return $file;
	}

	/**
	 * Fire plugins_loaded: the stubbed add_action only records callbacks, so
	 * run selection first, as PHP_INT_MIN does, then the rest.
	 */
	private function fire_plugins_loaded(): void {
		$GLOBALS['_fair_test_did_action']['plugins_loaded'] = 1;
		Fair_Events_Shared_Loader::select();
		foreach ( $GLOBALS['_fair_test_added_actions']['plugins_loaded'] ?? array() as $callback ) {
			if ( array( Fair_Events_Shared_Loader::class, 'select' ) !== $callback ) {
				call_user_func( $callback );
			}
		}
	}

	/**
	 * File a class loaded from.
	 *
	 * @param string $class_name Class.
	 * @return string
	 */
	private function file_of( string $class_name ): string {
		return str_replace( '\\', '/', (string) ( new \ReflectionClass( $class_name ) )->getFileName() );
	}

	/**
	 * Test notice templates.
	 *
	 * @param string $id    Message id.
	 * @param int    $count Count.
	 * @return string
	 */
	public static function message( $id, $count ) {
		return array(
			'conflict'         => '[conflict:' . $count . '] %1$s paused by %2$s',
			'conflict_unknown' => '[conflict_unknown:' . $count . '] %1$s paused',
			'outdated'         => '[outdated:' . $count . '] %1$s',
		)[ $id ];
	}

	/**
	 * Render the notices for a screen and capability set.
	 *
	 * @param string $screen_id Screen id.
	 * @param bool   $can       Whether the user can update plugins.
	 * @return string
	 */
	private function notices( string $screen_id, bool $can = true ): string {
		$GLOBALS['_fair_test_caps']   = $can ? array( 'update_plugins' ) : array();
		$GLOBALS['_fair_test_screen'] = (object) array(
			'id'        => $screen_id,
			'post_type' => '',
		);
		ob_start();
		Fair_Events_Shared_Loader::render_notices();
		return (string) ob_get_clean();
	}

	/**
	 * Load orders and build types for two updated plugins.
	 *
	 * @return array
	 */
	public static function orders(): array {
		return array(
			'newer loads first, PSR-4'    => array( true, false ),
			'newer loads last, PSR-4'     => array( false, false ),
			'newer loads first, classmap' => array( true, true ),
			'newer loads last, classmap'  => array( false, true ),
		);
	}

	/**
	 * Two updated plugins with different copies select the newer one in
	 * either load order, and the older one is listed as outdated.
	 *
	 * @param bool $newer_first Load the newer copy first.
	 * @param bool $classmap    Optimized builds.
	 */
	#[DataProvider( 'orders' )]
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_newest_copy_serves_shared_classes_in_both_orders( bool $newer_first, bool $classmap ): void {
		$newer = $this->make_plugin( 'fair-newer', '0.3.0' );
		$this->make_plugin( 'fair-older', '0.2.9' );

		$order = $newer_first ? array( 'fair-newer', 'fair-older' ) : array( 'fair-older', 'fair-newer' );
		$files = array();
		foreach ( $order as $slug ) {
			$files[ $slug ] = $this->load_updated( $slug, $classmap );
		}
		$started = array();
		foreach ( $files as $slug => $file ) {
			Fair_Events_Shared_Loader::when_ready(
				$file,
				static function () use ( &$started, $slug ) {
					$started[] = $slug;
				}
			);
		}

		$this->assertFalse( Fair_Events_Shared_Loader::is_ready(), 'Nothing is ready before plugins_loaded.' );
		$this->fire_plugins_loaded();

		$this->assertSame( 'selected', Fair_Events_Shared_Loader::report()['state'] );
		$this->assertSame( $newer . '/src/LoaderProbe/Marker.php', $this->file_of( \FairEventsShared\LoaderProbe\Marker::class ) );
		$this->assertSame( '0.3.0', \FairEventsShared\LoaderProbe\Marker::VERSION );
		$this->assertEqualsCanonicalizing( array( 'fair-newer', 'fair-older' ), $started );
		$this->assertSame( array( self::$root . '/fair-older/fair-older.php' => 'Fair Older' ), Fair_Events_Shared_Loader::outdated_plugins() );
	}

	/**
	 * A class only the older copy still has does not fall through to it.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_missing_class_does_not_fall_through_to_an_older_copy(): void {
		$this->make_plugin( 'fair-newer', '0.3.0' );
		$this->make_plugin( 'fair-older', '0.2.9', 'Retired' );
		$this->load_updated( 'fair-newer', true );
		$this->load_updated( 'fair-older', true );
		$this->fire_plugins_loaded();

		$this->assertFalse( class_exists( 'FairEventsShared\\LoaderProbe\\Retired' ) );
	}

	/**
	 * Equal versions select one of the identical copies; a class that loaded
	 * early from the other one is no conflict.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_equal_versions_use_any_identical_copy(): void {
		$first  = $this->make_plugin( 'fair-first', '0.3.0' );
		$second = $this->make_plugin( 'fair-second', '0.3.0' );
		$this->load_updated( 'fair-first' );
		$this->load_updated( 'fair-second' );
		class_exists( \FairEventsShared\LoaderProbe\Marker::class );
		$this->fire_plugins_loaded();

		$this->assertSame( 'selected', Fair_Events_Shared_Loader::report()['state'] );
		$this->assertContains( dirname( $this->file_of( \FairEventsShared\LoaderProbe\Marker::class ), 3 ), array( $first, $second ) );
		$this->assertSame( array(), Fair_Events_Shared_Loader::outdated_plugins() );
		$this->assertSame( '', $this->notices( 'plugins' ) );
	}

	/**
	 * A single plugin keeps loading its own copy and shows no notice.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_single_plugin_keeps_its_copy(): void {
		$dir  = $this->make_plugin( 'fair-only', '0.3.0' );
		$file = $this->load_updated( 'fair-only' );
		$this->fire_plugins_loaded();

		$this->assertTrue( Fair_Events_Shared_Loader::is_ready( $file ) );
		$this->assertSame( $dir . '/src/LoaderProbe/Marker.php', $this->file_of( \FairEventsShared\LoaderProbe\Marker::class ) );
		$this->assertSame( '', $this->notices( 'plugins' ) );
	}

	/**
	 * A legacy plugin (no loader) whose copy loaded a class before selection
	 * marks the request as conflicted: nothing is redirected, updated
	 * plugins stay off, and the provenance is the legacy file.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_early_loaded_legacy_class_is_a_conflict(): void {
		$this->make_plugin( 'fair-newer', '0.3.0', 'NewOnly' );
		$legacy = $this->make_plugin( 'fair-legacy', '0.2.1' );
		$file   = $this->load_updated( 'fair-newer' );
		$this->register_composer( 'fair-legacy', true );
		class_exists( \FairEventsShared\LoaderProbe\Marker::class );

		$started = false;
		Fair_Events_Shared_Loader::when_ready(
			$file,
			static function () use ( &$started ) {
				$started = true;
			}
		);
		$this->fire_plugins_loaded();

		$report = Fair_Events_Shared_Loader::report();
		$this->assertSame( 'conflict', $report['state'] );
		$this->assertNull( $report['selected'] );
		$this->assertSame( array( 'FairEventsShared\\LoaderProbe\\Marker' => $legacy . '/src/LoaderProbe/Marker.php' ), $report['conflicts'] );
		$this->assertFalse( $started );
		$this->assertFalse( Fair_Events_Shared_Loader::is_ready( $file ) );

		$notices = $this->notices( 'plugins' );
		$this->assertStringContainsString( 'notice-error', $notices );
		$this->assertStringContainsString( '[conflict:1] Fair Newer paused by Fair Legacy', $notices );
		// The plugin named in the conflict is not repeated as merely outdated.
		$this->assertStringNotContainsString( 'notice-warning', $notices );
	}

	/**
	 * A legacy copy registered without an early load is outdated, not a
	 * conflict, and its loader no longer serves shared classes.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_legacy_loader_cannot_override_selection(): void {
		$newer = $this->make_plugin( 'fair-newer', '0.3.0' );
		$this->make_plugin( 'fair-legacy', '0.2.1' );
		$this->load_updated( 'fair-newer' );
		$this->register_composer( 'fair-legacy', false );
		$this->fire_plugins_loaded();

		$this->assertSame( $newer . '/src/LoaderProbe/Marker.php', $this->file_of( \FairEventsShared\LoaderProbe\Marker::class ) );
		$notice = strip_tags( $this->notices( 'plugins' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- plain text of a test notice.
		$this->assertSame( '[outdated:1] Fair Legacy', trim( $notice ) );
	}

	/**
	 * The shipped Fair Timetable 0.8.0 autoloader, registered after an
	 * updated plugin, cannot override the selected copy.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_shipped_timetable_release_cannot_override_selection(): void {
		$installed = str_replace( '\\', '/', (string) realpath( dirname( __DIR__, 2 ) . '/vendor/fair-events/shared' ) );
		Fair_Events_Shared_Loader::register(
			array(
				'plugin_file' => dirname( __DIR__, 2 ) . '/fair-events.php',
				'package_dir' => $installed,
			)
		);
		require dirname( __DIR__, 3 ) . '/e2e/mu-plugins/lib/legacy-shared/fair-timetable-0.8.0/vendor/autoload.php';
		$this->fire_plugins_loaded();

		$this->assertSame( 'selected', Fair_Events_Shared_Loader::report()['state'] );
		$this->assertSame( $installed . '/src/Money.php', $this->file_of( \FairEventsShared\Money::class ) );
		$this->assertSame( $installed . '/src/Admin/SettingsPage.php', $this->file_of( \FairEventsShared\Admin\SettingsPage::class ) );
	}

	/**
	 * Notices: only for users who can update plugins, only on the Plugins
	 * screens and Fair pages, one notice listing every outdated plugin.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_outdated_notice_visibility(): void {
		$this->make_plugin( 'fair-newer', '0.3.0' );
		$this->make_plugin( 'fair-old-a', '0.2.1' );
		$this->make_plugin( 'fair-old-b', '0.2.5' );
		$this->load_updated( 'fair-newer' );
		$this->load_updated( 'fair-old-a' );
		$this->register_composer( 'fair-old-b', true );
		$this->fire_plugins_loaded();

		foreach ( array( 'plugins', 'plugins-network', 'toplevel_page_fair-events', 'fair-events_page_fair-events-venues', 'settings_page_fair-event-plugins' ) as $screen ) {
			$notices = $this->notices( $screen );
			$this->assertSame( 1, substr_count( $notices, '<div class="notice' ), $screen );
			$this->assertStringContainsString( '[outdated:2] Fair Old A, Fair Old B', $notices, $screen );
		}
		$this->assertSame( '', $this->notices( 'dashboard' ) );
		$this->assertSame( '', $this->notices( 'plugins', false ) );
	}

	/**
	 * A plugin activated after plugins_loaded joins the selection; a newer
	 * late copy waits for the next request.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_late_registration(): void {
		$current = $this->make_plugin( 'fair-current', '0.3.0' );
		$this->make_plugin( 'fair-older', '0.2.0', 'OlderOnly' );
		$this->make_plugin( 'fair-newest', '0.4.0' );
		$this->load_updated( 'fair-current' );
		$this->fire_plugins_loaded();

		$older = $this->load_updated( 'fair-older', true );
		$ran   = false;
		Fair_Events_Shared_Loader::when_ready(
			$older,
			static function () use ( &$ran ) {
				$ran = true;
			}
		);
		$this->assertTrue( $ran, 'An older late plugin starts immediately.' );
		$this->assertFalse( class_exists( 'FairEventsShared\\LoaderProbe\\OlderOnly' ), 'Its loader was stripped.' );
		$this->assertSame( $current . '/src/LoaderProbe/Marker.php', $this->file_of( \FairEventsShared\LoaderProbe\Marker::class ) );

		$newest = $this->load_updated( 'fair-newest' );
		$this->assertFalse( Fair_Events_Shared_Loader::is_ready( $newest ) );
	}

	/**
	 * Remove a directory tree.
	 *
	 * @param string $dir Directory.
	 */
	private function remove_tree( string $dir ): void {
		foreach ( new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( $dir, \FilesystemIterator::SKIP_DOTS ), \RecursiveIteratorIterator::CHILD_FIRST ) as $item ) {
			$item->isDir() ? rmdir( $item->getPathname() ) : unlink( $item->getPathname() );
		}
		rmdir( $dir );
	}
}
