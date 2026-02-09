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
		'fair-audience-edit-poll'          => array(
			'title'    => 'Edit Poll',
			'callback' => 'render_edit_poll_page',
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
		add_menu_page(
			__( 'Fair Audience', 'fair-audience' ),
			__( 'Fair Audience', 'fair-audience' ),
			'manage_options',
			'fair-audience',
			array( $this, 'render_all_participants_page' ),
			'dashicons-groups',
			31
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

		// Submenu page - Collaborators.
		add_submenu_page(
			'fair-audience',
			__( 'Collaborators', 'fair-audience' ),
			__( 'Collaborators', 'fair-audience' ),
			'manage_options',
			'fair-audience-collaborators',
			array( $this, 'render_collaborators_page' )
		);

		// Submenu page - Groups.
		add_submenu_page(
			'fair-audience',
			__( 'Groups', 'fair-audience' ),
			__( 'Groups', 'fair-audience' ),
			'manage_options',
			'fair-audience-groups',
			array( $this, 'render_groups_page' )
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
		$this->register_hidden_page( 'fair-audience-edit-poll' );

		// Submenu page - Instagram Posts.
		add_submenu_page(
			'fair-audience',
			__( 'Instagram Posts', 'fair-audience' ),
			__( 'Instagram Posts', 'fair-audience' ),
			'manage_options',
			'fair-audience-instagram-posts',
			array( $this, 'render_instagram_posts_page' )
		);

		// Submenu page - Image Templates.
		add_submenu_page(
			'fair-audience',
			__( 'Image Templates', 'fair-audience' ),
			__( 'Image Templates', 'fair-audience' ),
			'manage_options',
			'fair-audience-image-templates',
			array( $this, 'render_image_templates_page' )
		);

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
	 * Render Collaborators page.
	 */
	public function render_collaborators_page() {
		$page = new CollaboratorsPage();
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
	 * Render Groups page.
	 */
	public function render_groups_page() {
		$page = new GroupsPage();
		$page->render();
	}

	/**
	 * Render Instagram Posts page.
	 */
	public function render_instagram_posts_page() {
		$page = new InstagramPostsPage();
		$page->render();
	}

	/**
	 * Render Image Templates page.
	 */
	public function render_image_templates_page() {
		$page = new ImageTemplatesPage();
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

		// Collaborators page.
		if ( 'fair-audience_page_fair-audience-collaborators' === $hook ) {
			$this->enqueue_page_script( 'collaborators', $plugin_dir );
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

		// Groups page.
		if ( 'fair-audience_page_fair-audience-groups' === $hook ) {
			$this->enqueue_page_script( 'groups', $plugin_dir );
		}

		// Instagram Posts page.
		if ( 'fair-audience_page_fair-audience-instagram-posts' === $hook ) {
			$this->enqueue_page_script( 'instagram-posts', $plugin_dir );
		}

		// Image Templates page.
		if ( 'fair-audience_page_fair-audience-image-templates' === $hook ) {
			wp_enqueue_media();
			$this->enqueue_page_script( 'image-templates', $plugin_dir );
		}

		// Settings page.
		if ( 'fair-audience_page_fair-audience-settings' === $hook ) {
			$this->enqueue_page_script( 'settings', $plugin_dir );
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
