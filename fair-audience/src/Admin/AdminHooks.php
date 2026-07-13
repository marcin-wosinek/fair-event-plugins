<?php
/**
 * Admin Hooks
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin hooks for menu and script registration.
 */
class AdminHooks {

	/**
	 * Hidden submenu pages configuration.
	 *
	 * WordPress can't find hidden pages (empty parent slug) in the menu structure,
	 * causing PHP 8.1+ deprecation warnings. This configuration is used to:
	 * - Register the pages
	 * - Set proper titles to prevent strip_tags() warnings
	 * - Set parent_file/submenu_file to prevent null value warnings
	 *
	 * @var array<string, array{title: string, callback: string}>
	 */
	private const HIDDEN_PAGES = array(
		'fair-audience-event-participants' => array(
			'title'    => 'Event Participants',
			'callback' => 'render_event_participants_page',
		),
		'fair-audience-participant-detail' => array(
			'title'    => 'Participant Detail',
			'callback' => 'render_participant_detail_page',
		),
	);

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
		add_action( 'current_screen', array( $this, 'set_title_for_hidden_pages' ) );
		add_filter( 'parent_file', array( $this, 'fix_parent_file_for_hidden_pages' ) );
		add_filter( 'submenu_file', array( $this, 'fix_submenu_file_for_hidden_pages' ), 10, 2 );

		// Register the Audience tab on fair-events' manage-event page via
		// its tab-registry filter, rather than fair-events importing this
		// bundle directly. See enqueue_manage_event_audience_tab_assets()
		// for the dependency ordering that avoids a first-render flicker.
		add_action( 'fair_events_manage_event_enqueue_assets', array( $this, 'enqueue_manage_event_audience_tab_assets' ) );
	}

	/**
	 * Check if current page is a hidden page.
	 *
	 * @return bool True if current page is hidden.
	 */
	private function is_hidden_page(): bool {
		global $plugin_page;
		return isset( self::HIDDEN_PAGES[ $plugin_page ] );
	}

	/**
	 * Fix parent_file for hidden submenu pages to prevent PHP 8.1+ deprecation warnings.
	 *
	 * @param string|null $parent_file The parent file.
	 * @return string The parent file (never null).
	 */
	public function fix_parent_file_for_hidden_pages( $parent_file ) {
		if ( $this->is_hidden_page() ) {
			return 'fair-audience';
		}
		return $parent_file ?? '';
	}

	/**
	 * Fix submenu_file for hidden submenu pages to prevent PHP 8.1+ deprecation warnings.
	 *
	 * @param string|null $submenu_file The submenu file.
	 * @param string      $parent_file  The parent file.
	 * @return string The submenu file (never null).
	 */
	public function fix_submenu_file_for_hidden_pages( $submenu_file, $parent_file ) {
		global $plugin_page;

		if ( $this->is_hidden_page() ) {
			return $plugin_page;
		}
		return $submenu_file ?? '';
	}

	/**
	 * Set the admin page title for hidden pages to prevent PHP 8.1+ deprecation warnings.
	 */
	public function set_title_for_hidden_pages() {
		global $plugin_page, $title;

		if ( isset( self::HIDDEN_PAGES[ $plugin_page ] ) && empty( $title ) ) {
			$title = __( self::HIDDEN_PAGES[ $plugin_page ]['title'], 'fair-audience' );
		}
	}

	/**
	 * Register a hidden submenu page using the HIDDEN_PAGES configuration.
	 *
	 * @param string $menu_slug The menu slug for the hidden page.
	 */
	private function register_hidden_page( string $menu_slug ): void {
		if ( ! isset( self::HIDDEN_PAGES[ $menu_slug ] ) ) {
			return;
		}

		$config = self::HIDDEN_PAGES[ $menu_slug ];
		$title  = __( $config['title'], 'fair-audience' );

		add_submenu_page(
			'', // Hidden from menu.
			$title,
			$title,
			'manage_options',
			$menu_slug,
			array( $this, $config['callback'] )
		);
	}

	/**
	 * Register admin menu pages.
	 */
	public function register_admin_menu() {
		// Main menu page - All Participants.
		// Activity Timeline moved to the fair-audience-experimental companion.
		add_menu_page(
			__( 'Fair Audience', 'fair-audience' ),
			__( 'Fair Audience', 'fair-audience' ),
			'manage_options',
			'fair-audience',
			array( $this, 'render_all_participants_page' ),
			'dashicons-groups',
			'20.3'
		);

		// Override first submenu item label (same slug as parent).
		add_submenu_page(
			'fair-audience',
			__( 'All Participants', 'fair-audience' ),
			__( 'All Participants', 'fair-audience' ),
			'manage_options',
			'fair-audience',
			array( $this, 'render_all_participants_page' )
		);

		// Submenu page - By Event.
		add_submenu_page(
			'fair-audience',
			__( 'By Event', 'fair-audience' ),
			__( 'By Event', 'fair-audience' ),
			'manage_options',
			'fair-audience-by-event',
			array( $this, 'render_events_list_page' )
		);

		// Hidden submenu page - Event Participants.
		$this->register_hidden_page( 'fair-audience-event-participants' );

		// Hidden submenu page - Participant Detail.
		$this->register_hidden_page( 'fair-audience-participant-detail' );

		// Submenu page - Weekly Digest (requires stable fair-events).
		if ( class_exists( 'FairEvents\Core\Plugin' ) ) {
			add_submenu_page(
				'fair-audience',
				__( 'Weekly Digest', 'fair-audience' ),
				__( 'Weekly Digest', 'fair-audience' ),
				'manage_options',
				'fair-audience-weekly-digest',
				array( $this, 'render_weekly_digest_page' )
			);
		}

		// Submenu page - Settings.
		add_submenu_page(
			'fair-audience',
			__( 'Settings', 'fair-audience' ),
			__( 'Settings', 'fair-audience' ),
			'manage_options',
			'fair-audience-settings',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Render All Participants page.
	 */
	public function render_all_participants_page() {
		$page = new AllParticipantsPage();
		$page->render();
	}

	/**
	 * Render Events List page.
	 */
	public function render_events_list_page() {
		$page = new EventsListPage();
		$page->render();
	}

	/**
	 * Render Event Participants page.
	 */
	public function render_event_participants_page() {
		$page = new EventParticipantsPage();
		$page->render();
	}

	/**
	 * Render Participant Detail page.
	 */
	public function render_participant_detail_page() {
		$page = new ParticipantDetailPage();
		$page->render();
	}

	/**
	 * Render Settings page.
	 */
	public function render_settings_page() {
		$page = new SettingsPage();
		$page->render();
	}

	/**
	 * Render Weekly Digest page.
	 */
	public function render_weekly_digest_page() {
		$page = new WeeklyDigestPage();
		$page->render();
	}

	/**
	 * Enqueue admin scripts.
	 *
	 * @param string $hook Page hook.
	 */
	public function enqueue_admin_scripts( $hook ) {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

		// All Participants page (also the toplevel Fair Audience menu page).
		if ( 'toplevel_page_fair-audience' === $hook || 'fair-audience_page_fair-audience-all-participants' === $hook ) {
			$this->enqueue_page_script( 'all-participants', $plugin_dir );

			wp_localize_script(
				'fair-audience-all-participants',
				'fairAudienceAllParticipantsData',
				array(
					'participantsUrl' => admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' ),
				)
			);
		}

		// Events List page.
		if ( 'fair-audience_page_fair-audience-by-event' === $hook ) {
			$this->enqueue_page_script( 'events-list', $plugin_dir );
		}

		// Event Participants page.
		if ( 'admin_page_fair-audience-event-participants' === $hook ) {
			$this->enqueue_page_script( 'event-participants', $plugin_dir );
		}

		// Participant Detail page.
		if ( 'admin_page_fair-audience-participant-detail' === $hook ) {
			$this->enqueue_page_script( 'participant-detail', $plugin_dir );
		}

		// Settings page.
		if ( 'fair-audience_page_fair-audience-settings' === $hook ) {
			$this->enqueue_page_script( 'settings', $plugin_dir );
			wp_localize_script(
				'fair-audience-settings',
				'fairAudienceSettingsData',
				array(
					'features' => \FairAudience\Core\Features::all(),
				)
			);
		}

		// Weekly Digest page.
		if ( 'fair-audience_page_fair-audience-weekly-digest' === $hook ) {
			wp_enqueue_editor();
			$this->enqueue_page_script( 'weekly-digest', $plugin_dir );
		}
	}

	/**
	 * Enqueue page script.
	 *
	 * @param string $page_name  Page name.
	 * @param string $plugin_dir Plugin directory path.
	 */
	private function enqueue_page_script( $page_name, $plugin_dir ) {
		$asset_file = $plugin_dir . "build/admin/{$page_name}/index.asset.php";

		if ( file_exists( $asset_file ) ) {
			$asset_data = include $asset_file;

			wp_enqueue_script(
				"fair-audience-{$page_name}",
				plugin_dir_url( dirname( __DIR__ ) ) . "build/admin/{$page_name}/index.js",
				$asset_data['dependencies'],
				$asset_data['version'],
				true
			);

			wp_set_script_translations(
				"fair-audience-{$page_name}",
				'fair-audience',
				\FairAudience\Core\Features::script_translations_path()
			);

			wp_enqueue_style( 'wp-components' );

			$style_file = $plugin_dir . "build/admin/{$page_name}/style-index.css";
			if ( file_exists( $style_file ) ) {
				wp_enqueue_style(
					"fair-audience-{$page_name}",
					plugin_dir_url( dirname( __DIR__ ) ) . "build/admin/{$page_name}/style-index.css",
					array( 'wp-components' ),
					$asset_data['version']
				);
			}
		}
	}

	/**
	 * Enqueue the Audience tab bundle on the fair-events manage-event page.
	 *
	 * Declares `fair-events-manage-event` as a script dependency so its
	 * `addFilter()` call runs before the host bundle's `domReady()` mount,
	 * avoiding a first-render flicker where the tab pops in late.
	 *
	 * @return void
	 */
	public function enqueue_manage_event_audience_tab_assets() {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );
		$asset_file = include $plugin_dir . 'build/admin/manage-event-audience-tab/index.asset.php';

		wp_enqueue_script(
			'fair-audience-manage-event-audience-tab',
			plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/manage-event-audience-tab/index.js',
			array_merge( $asset_file['dependencies'], array( 'fair-events-manage-event' ) ),
			$asset_file['version'],
			true
		);

		wp_set_script_translations(
			'fair-audience-manage-event-audience-tab',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);
	}
}
