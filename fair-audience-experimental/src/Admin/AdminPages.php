<?php
/**
 * Admin Pages for Fair Audience Experimental
 *
 * Registers the experimental settings page plus each migrated bundle's admin
 * page as a submenu under the fair-audience menu, gated by Features.
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering experimental admin menu pages
 */
class AdminPages {
	/**
	 * Map of page slug => admin page hook name.
	 *
	 * @var array<string,string>
	 */
	private $page_hooks = array();

	/**
	 * Parent menu slug (owned by fair-audience).
	 *
	 * @return string
	 */
	private function get_menu_parent_slug() {
		return 'fair-audience';
	}

	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		// Priority 11: run after fair-audience's own add_menu_page() call so the
		// parent hook name is registered regardless of plugin activation order
		// (see ADDING_NEW_PLUGIN.md "Experimental plugin admin submenus show 404").
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ), 11 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		$parent = $this->get_menu_parent_slug();

		$this->page_hooks['fair-audience-experimental-settings'] = add_submenu_page(
			$parent,
			__( 'Experimental Settings', 'fair-audience-experimental' ),
			__( 'Experimental', 'fair-audience-experimental' ),
			'manage_options',
			'fair-audience-experimental-settings',
			array( $this, 'render_settings_page' )
		);

		// Activity Timeline — `timeline` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'timeline' ) ) {
			$this->page_hooks['fair-audience-timeline'] = add_submenu_page(
				$parent,
				__( 'Activity', 'fair-audience-experimental' ),
				__( 'Activity', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-timeline',
				array( $this, 'render_timeline_page' )
			);
		}

		// Collaborators — `collaborators` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'collaborators' ) ) {
			$this->page_hooks['fair-audience-collaborators'] = add_submenu_page(
				$parent,
				__( 'Collaborators', 'fair-audience-experimental' ),
				__( 'Collaborators', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-collaborators',
				array( $this, 'render_collaborators_page' )
			);
		}

		// Membership Fees — `fees` bundle (only when fair-payments-connector is active).
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'fees' ) && class_exists( 'FairPaymentsConnector\Core\Plugin' ) ) {
			$this->page_hooks['fair-audience-fees'] = add_submenu_page(
				$parent,
				__( 'Membership Fees', 'fair-audience-experimental' ),
				__( 'Membership Fees', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-fees',
				array( $this, 'render_fees_list_page' )
			);

			$this->page_hooks['fair-audience-fee-detail'] = add_submenu_page(
				'',
				__( 'Fee Detail', 'fair-audience-experimental' ),
				__( 'Fee Detail', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-fee-detail',
				array( $this, 'render_fee_detail_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-audience-fee-detail'], __( 'Fee Detail', 'fair-audience-experimental' ) );
		}

		// Import — `import` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'import' ) ) {
			$this->page_hooks['fair-audience-import'] = add_submenu_page(
				$parent,
				__( 'Import', 'fair-audience-experimental' ),
				__( 'Import', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-import',
				array( $this, 'render_import_page' )
			);
		}

		// Polls — `polls` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'polls' ) ) {
			$this->page_hooks['fair-audience-polls'] = add_submenu_page(
				$parent,
				__( 'Polls', 'fair-audience-experimental' ),
				__( 'Polls', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-polls',
				array( $this, 'render_polls_list_page' )
			);

			$this->page_hooks['fair-audience-edit-poll'] = add_submenu_page(
				'',
				__( 'Edit Poll', 'fair-audience-experimental' ),
				__( 'Edit Poll', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-edit-poll',
				array( $this, 'render_edit_poll_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-audience-edit-poll'], __( 'Edit Poll', 'fair-audience-experimental' ) );
		}

		// Instagram Posts — `instagram` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'instagram' ) ) {
			$this->page_hooks['fair-audience-instagram-posts'] = add_submenu_page(
				$parent,
				__( 'Instagram Posts', 'fair-audience-experimental' ),
				__( 'Instagram Posts', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-instagram-posts',
				array( $this, 'render_instagram_posts_page' )
			);
		}

		// Image Templates — `image-templates` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'image-templates' ) ) {
			$this->page_hooks['fair-audience-image-templates'] = add_submenu_page(
				$parent,
				__( 'Image Templates', 'fair-audience-experimental' ),
				__( 'Image Templates', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-image-templates',
				array( $this, 'render_image_templates_page' )
			);
		}

		// Weekly Schedule — `weekly-schedule` bundle (only when fair-events is active).
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'weekly-schedule' ) && class_exists( 'FairEvents\Core\Plugin' ) ) {
			$this->page_hooks['fair-audience-weekly-schedule'] = add_submenu_page(
				$parent,
				__( 'Weekly Schedule', 'fair-audience-experimental' ),
				__( 'Weekly Schedule', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-weekly-schedule',
				array( $this, 'render_weekly_schedule_page' )
			);
		}

		// Groups — `groups` bundle.
		if ( \FairAudienceExperimental\Core\Features::is_enabled( 'groups' ) ) {
			$this->page_hooks['fair-audience-groups'] = add_submenu_page(
				$parent,
				__( 'Groups', 'fair-audience-experimental' ),
				__( 'Groups', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-groups',
				array( $this, 'render_groups_page' )
			);

			$this->page_hooks['fair-audience-group-detail'] = add_submenu_page(
				'',
				__( 'Group Detail', 'fair-audience-experimental' ),
				__( 'Group Detail', 'fair-audience-experimental' ),
				'manage_options',
				'fair-audience-group-detail',
				array( $this, 'render_group_detail_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-audience-group-detail'], __( 'Group Detail', 'fair-audience-experimental' ) );
		}
	}

	/**
	 * Set the page title for a hidden admin page.
	 *
	 * @param string $hookname   The page hook name returned by add_submenu_page().
	 * @param string $page_title The title to set.
	 * @return void
	 */
	private function set_hidden_page_title( $hookname, $page_title ) {
		add_action(
			'load-' . $hookname,
			static function () use ( $page_title ) {
				global $title;
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$title = $page_title;
			}
		);
	}

	/**
	 * Enqueue admin scripts for the plugin's admin pages
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		$slug = array_search( $hook, $this->page_hooks, true );
		if ( false === $slug ) {
			return;
		}

		if ( 'fair-audience-experimental-settings' === $slug ) {
			$asset_file = include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

			wp_enqueue_script(
				'fair-audience-experimental-settings',
				FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_localize_script(
				'fair-audience-experimental-settings',
				'fairAudienceExperimentalSettingsData',
				array(
					'features' => \FairAudienceExperimental\Core\Features::all(),
				)
			);

			wp_set_script_translations( 'fair-audience-experimental-settings', 'fair-audience-experimental' );
			wp_enqueue_style( 'wp-components' );
			return;
		}

		$exp_url = FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_URL;
		$exp_dir = FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR;

		switch ( $slug ) {
			case 'fair-audience-timeline':
				$this->enqueue_page_script( 'timeline', $exp_url, $exp_dir );
				break;

			case 'fair-audience-collaborators':
				$this->enqueue_page_script( 'collaborators', $exp_url, $exp_dir );
				wp_localize_script(
					'fair-audience-experimental-collaborators',
					'fairAudienceCollaboratorsData',
					array(
						'participantsUrl'        => admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' ),
						'collaboratorProfileUrl' => home_url( '?collaborator_profile=1' ),
					)
				);
				break;

			case 'fair-audience-fees':
				$this->enqueue_page_script( 'fees-list', $exp_url, $exp_dir );
				break;

			case 'fair-audience-fee-detail':
				$this->enqueue_page_script( 'fee-detail', $exp_url, $exp_dir );
				wp_localize_script(
					'fair-audience-experimental-fee-detail',
					'fairPaymentsConnector',
					array(
						'currency' => get_option( 'fair_payment_currency', 'EUR' ),
					)
				);
				break;

			case 'fair-audience-import':
				$this->enqueue_page_script( 'import', $exp_url, $exp_dir );
				break;

			case 'fair-audience-polls':
				$this->enqueue_page_script( 'polls-list', $exp_url, $exp_dir );
				break;

			case 'fair-audience-edit-poll':
				$this->enqueue_page_script( 'edit-poll', $exp_url, $exp_dir );
				break;

			case 'fair-audience-instagram-posts':
				wp_enqueue_media();
				$this->enqueue_page_script( 'instagram-posts', $exp_url, $exp_dir );
				break;

			case 'fair-audience-image-templates':
				wp_enqueue_media();
				$this->enqueue_page_script( 'image-templates', $exp_url, $exp_dir );
				break;

			case 'fair-audience-weekly-schedule':
				$this->enqueue_page_script( 'weekly-schedule', $exp_url, $exp_dir );
				wp_localize_script(
					'fair-audience-experimental-weekly-schedule',
					'fairAudienceWeeklyScheduleData',
					array(
						'participantsUrl' => admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' ),
					)
				);
				break;

			case 'fair-audience-groups':
				$this->enqueue_page_script( 'groups', $exp_url, $exp_dir );
				wp_localize_script(
					'fair-audience-experimental-groups',
					'fairAudienceGroupsData',
					array(
						'groupDetailUrl' => admin_url( 'admin.php?page=fair-audience-group-detail&group_id=' ),
					)
				);
				break;

			case 'fair-audience-group-detail':
				$this->enqueue_page_script( 'group-detail', $exp_url, $exp_dir );
				wp_localize_script(
					'fair-audience-experimental-group-detail',
					'fairAudienceGroupDetailData',
					array(
						'groupsListUrl' => admin_url( 'admin.php?page=fair-audience-groups' ),
					)
				);
				break;
		}
	}

	/**
	 * Enqueue a bundle admin page's script + styles from this plugin's build directory.
	 *
	 * @param string $page_name Page directory name under src/Admin (and build/admin).
	 * @param string $exp_url   This plugin's URL.
	 * @param string $exp_dir   This plugin's directory path.
	 * @return void
	 */
	private function enqueue_page_script( $page_name, $exp_url, $exp_dir ) {
		$asset_file = include $exp_dir . "build/admin/{$page_name}/index.asset.php";
		$handle     = "fair-audience-experimental-{$page_name}";

		wp_enqueue_script(
			$handle,
			$exp_url . "build/admin/{$page_name}/index.js",
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_set_script_translations( $handle, 'fair-audience-experimental' );

		wp_enqueue_style( 'wp-components' );
	}

	/**
	 * Render experimental settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-audience-experimental-settings-root"></div>
		<?php
	}

	/**
	 * Render Timeline page.
	 *
	 * @return void
	 */
	public function render_timeline_page() {
		$page = new \FairAudienceExperimental\Admin\TimelinePage();
		$page->render();
	}

	/**
	 * Render Collaborators page.
	 *
	 * @return void
	 */
	public function render_collaborators_page() {
		$page = new \FairAudienceExperimental\Admin\CollaboratorsPage();
		$page->render();
	}

	/**
	 * Render Fees List page.
	 *
	 * @return void
	 */
	public function render_fees_list_page() {
		$page = new \FairAudienceExperimental\Admin\FeesListPage();
		$page->render();
	}

	/**
	 * Render Fee Detail page.
	 *
	 * @return void
	 */
	public function render_fee_detail_page() {
		$page = new \FairAudienceExperimental\Admin\FeeDetailPage();
		$page->render();
	}

	/**
	 * Render Import page.
	 *
	 * @return void
	 */
	public function render_import_page() {
		$page = new \FairAudienceExperimental\Admin\ImportPage();
		$page->render();
	}

	/**
	 * Render Polls List page.
	 *
	 * @return void
	 */
	public function render_polls_list_page() {
		$page = new \FairAudienceExperimental\Admin\PollsListPage();
		$page->render();
	}

	/**
	 * Render Edit Poll page.
	 *
	 * @return void
	 */
	public function render_edit_poll_page() {
		$page = new \FairAudienceExperimental\Admin\EditPollPage();
		$page->render();
	}

	/**
	 * Render Instagram Posts page.
	 *
	 * @return void
	 */
	public function render_instagram_posts_page() {
		$page = new \FairAudienceExperimental\Admin\InstagramPostsPage();
		$page->render();
	}

	/**
	 * Render Image Templates page.
	 *
	 * @return void
	 */
	public function render_image_templates_page() {
		$page = new \FairAudienceExperimental\Admin\ImageTemplatesPage();
		$page->render();
	}

	/**
	 * Render Weekly Schedule page.
	 *
	 * @return void
	 */
	public function render_weekly_schedule_page() {
		$page = new \FairAudienceExperimental\Admin\WeeklySchedulePage();
		$page->render();
	}

	/**
	 * Render Groups page.
	 *
	 * @return void
	 */
	public function render_groups_page() {
		$page = new \FairAudienceExperimental\Admin\GroupsPage();
		$page->render();
	}

	/**
	 * Render Group Detail page.
	 *
	 * @return void
	 */
	public function render_group_detail_page() {
		$page = new \FairAudienceExperimental\Admin\GroupDetailPage();
		$page->render();
	}
}
