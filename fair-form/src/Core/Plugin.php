<?php
/**
 * Main Plugin Class
 *
 * @package FairForm
 */

namespace FairForm\Core;

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
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-form', false, 'fair-form/languages' );
				}
			}
		);

		add_action(
			'admin_init',
			function () {
				register_setting(
					'fair_form_settings',
					Features::OPTION,
					array(
						'type'              => 'object',
						'sanitize_callback' => array( Features::class, 'sanitize_option' ),
						'default'           => array(),
					)
				);
			}
		);

		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );

		// Deferred notification dispatch: the admin notification email is
		// scheduled rather than sent inline so a slow/unreachable mail
		// transport can't make submit requests time out. See
		// FormNotificationService::defer().
		add_action(
			\FairForm\Services\FormNotificationService::DEFERRED_HOOK,
			array( \FairForm\Services\FormNotificationService::class, 'run_deferred' ),
			10,
			2
		);

		new \FairForm\Admin\AdminHooks();

		$block_hooks = new \FairForm\Hooks\BlockHooks();

		$this->load_shared_settings_page();
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

		if ( class_exists( '\FairEventsShared\Admin\SettingsPage' ) ) {
			\FairEventsShared\Admin\SettingsPage::boot();
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
			'section_title' => __( 'Translations', 'fair-form' ),
			'id'            => 'fair-form/bundled-translations',
			'type'          => 'checkbox',
			'option'        => Features::OPTION,
			'key'           => 'bundled-translations',
			'label'         => __( 'Fair Form', 'fair-form' ),
			'description'   => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs.', 'fair-form' ),
			'value'         => Features::is_enabled( 'bundled-translations' ),
			'locked'        => Features::is_forced( 'bundled-translations' ),
			'locked_note'   => __( 'Forced by a wp-config constant — change it there.', 'fair-form' ),
		);
		return $fields;
	}

	/**
	 * Register REST API endpoints.
	 *
	 * @return void
	 */
	public function register_api_endpoints() {
		$fair_form_controller = new \FairForm\API\FairFormController();
		$fair_form_controller->register_routes();

		$questionnaire_responses_controller = new \FairForm\API\QuestionnaireResponsesController();
		$questionnaire_responses_controller->register_routes();

		$url_preview_controller = new \FairForm\API\UrlPreviewController();
		$url_preview_controller->register_routes();
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public static function activate() {
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public static function deactivate() {
	}
}
