<?php
/**
 * Main Plugin Class
 *
 * @package FairFinance
 */

namespace FairFinance\Core;

use FairFinance\Database\Schema;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class
 */
class Plugin {
	/**
	 * Singleton instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

	/**
	 * Get singleton instance
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor
	 */
	private function __construct() {
		$this->init_hooks();
	}

	/**
	 * Initialize WordPress hooks
	 *
	 * @return void
	 */
	private function init_hooks() {
		add_action(
			'init',
			static function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-finance', false, 'fair-finance/languages' );
				}

				if ( Schema::VERSION !== get_option( 'fair_finance_schema_version' ) ) {
					Schema::create_tables();
				}
			}
		);
		new \FairFinance\API\RestHooks();
		\FairFinance\Services\SettlementReconciliation::register_guards();

		// Settlement reconciliation needs to read Mollie settlements, so ask
		// Fair Payments Connector to request that permission when connecting.
		add_filter( 'fair_payment_request_settlement_access', '__return_true' );
		if ( is_admin() ) {
			( new \FairFinance\Admin\AdminPages() )->init();
		}

		$this->load_shared_settings_page();
	}

	/**
	 * Boot the shared central "Fair Event Plugins" settings screen once the
	 * shared library is safe to use.
	 *
	 * Fair Finance doesn't bundle fair-events-shared's PHP package; the
	 * screen comes from any active Fair Event plugin that does.
	 *
	 * @return void
	 */
	public static function boot_shared_settings_page() {
		if ( class_exists( 'Fair_Events_Shared_Loader', false ) && ! \Fair_Events_Shared_Loader::is_ready() ) {
			return;
		}
		if ( class_exists( '\FairEventsShared\Admin\SettingsPage' ) ) {
			\FairEventsShared\Admin\SettingsPage::boot();
		}
	}

	/**
	 * Boot the shared central "Fair Event Plugins" settings screen and
	 * register this plugin's bundled-translations row on it.
	 *
	 * @return void
	 */
	private function load_shared_settings_page() {
		if ( ! is_admin() ) {
			return;
		}

		// This plugin bundles no shared library and boots another plugin's
		// copy. Loading it while plugins are still loading would pick a copy
		// before the newest is selected (#2181), so wait until every plugin
		// has loaded and the selection has run.
		if ( ! did_action( 'plugins_loaded' ) ) {
			add_action( 'plugins_loaded', array( self::class, 'boot_shared_settings_page' ), 0 );
		} else {
			self::boot_shared_settings_page();
		}

		add_filter( 'fair_event_plugins_settings_fields', array( $this, 'register_shared_settings_fields' ) );
	}

	/**
	 * Register this plugin's bundled-translations row on the shared screen.
	 *
	 * @param array $fields Field descriptors collected so far.
	 * @return array Field descriptors with this plugin's row appended.
	 */
	public function register_shared_settings_fields( $fields ) {
		$fields[] = array(
			'section'       => 'translations',
			'section_title' => __( 'Translations', 'fair-finance' ),
			'id'            => 'fair-finance/bundled-translations',
			'type'          => 'checkbox',
			'option'        => Features::OPTION,
			'key'           => 'bundled-translations',
			'label'         => __( 'Fair Finance', 'fair-finance' ),
			'description'   => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs.', 'fair-finance' ),
			'value'         => Features::is_enabled( 'bundled-translations' ),
			'locked'        => Features::is_forced( 'bundled-translations' ),
			'locked_note'   => __( 'Forced by a wp-config constant — change it there.', 'fair-finance' ),
		);
		return $fields;
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public static function activate() {
		Schema::create_tables();
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public static function deactivate() {
	}
}
