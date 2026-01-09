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
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages.
	 */
	public function register_admin_menu() {
		// Main menu page - All Participants.
		add_menu_page(
			__( 'Fair Audience', 'fair-audience' ),
			__( 'Fair Audience', 'fair-audience' ),
			'manage_options',
			'fair-audience',
			array( $this, 'render_all_participants_page' ),
			'dashicons-groups',
			31
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
		add_submenu_page(
			'', // Hidden from menu.
			__( 'Event Participants', 'fair-audience' ),
			__( 'Event Participants', 'fair-audience' ),
			'manage_options',
			'fair-audience-event-participants',
			array( $this, 'render_event_participants_page' )
		);

		// Submenu page - Import.
		add_submenu_page(
			'fair-audience',
			__( 'Import', 'fair-audience' ),
			__( 'Import', 'fair-audience' ),
			'manage_options',
			'fair-audience-import',
			array( $this, 'render_import_page' )
		);

		// Submenu page - Polls.
		add_submenu_page(
			'fair-audience',
			__( 'Polls', 'fair-audience' ),
			__( 'Polls', 'fair-audience' ),
			'manage_options',
			'fair-audience-polls',
			array( $this, 'render_polls_list_page' )
		);

		// Hidden submenu page - Edit Poll.
		add_submenu_page(
			'', // Hidden from menu.
			__( 'Edit Poll', 'fair-audience' ),
			__( 'Edit Poll', 'fair-audience' ),
			'manage_options',
			'fair-audience-edit-poll',
			array( $this, 'render_edit_poll_page' )
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
	 * Render Import page.
	 */
	public function render_import_page() {
		$page = new ImportPage();
		$page->render();
	}

	/**
	 * Render Polls List page.
	 */
	public function render_polls_list_page() {
		$page = new PollsListPage();
		$page->render();
	}

	/**
	 * Render Edit Poll page.
	 */
	public function render_edit_poll_page() {
		$page = new EditPollPage();
		$page->render();
	}

	/**
	 * Enqueue admin scripts.
	 *
	 * @param string $hook Page hook.
	 */
	public function enqueue_admin_scripts( $hook ) {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

		// All Participants page.
		if ( 'toplevel_page_fair-audience' === $hook ) {
			$this->enqueue_page_script( 'all-participants', $plugin_dir );
		}

		// Events List page.
		if ( 'fair-audience_page_fair-audience-by-event' === $hook ) {
			$this->enqueue_page_script( 'events-list', $plugin_dir );
		}

		// Event Participants page.
		if ( 'admin_page_fair-audience-event-participants' === $hook ) {
			$this->enqueue_page_script( 'event-participants', $plugin_dir );
		}

		// Import page.
		if ( 'fair-audience_page_fair-audience-import' === $hook ) {
			$this->enqueue_page_script( 'import', $plugin_dir );
		}

		// Polls List page.
		if ( 'fair-audience_page_fair-audience-polls' === $hook ) {
			$this->enqueue_page_script( 'polls-list', $plugin_dir );
		}

		// Edit Poll page.
		if ( 'admin_page_fair-audience-edit-poll' === $hook ) {
			$this->enqueue_page_script( 'edit-poll', $plugin_dir );
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
				$plugin_dir . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}
	}
}
