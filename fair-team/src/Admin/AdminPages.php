<?php
/**
 * Admin Pages for Fair Team
 *
 * @package FairTeam
 */

namespace FairTeam\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering admin menu pages
 */
class AdminPages {
	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Migration page
		add_submenu_page(
			'edit.php?post_type=fair_team_member',
			__( 'Migrate Posts to Team Members', 'fair-team' ),
			__( 'Migrate Posts', 'fair-team' ),
			'manage_options',
			'fair-team-migration',
			array( $this, 'render_migration_page' )
		);

		// Settings page
		add_submenu_page(
			'edit.php?post_type=fair_team_member',
			__( 'Fair Team Settings', 'fair-team' ),
			__( 'Settings', 'fair-team' ),
			'manage_options',
			'fair-team-settings',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Fair Team settings page
		if ( 'fair_team_member_page_fair-team-settings' === $hook ) {
			$asset_file = include FAIR_TEAM_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

			wp_enqueue_script(
				'fair-team-settings',
				FAIR_TEAM_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-team-settings',
				'fair-team',
				FAIR_TEAM_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}

		// Fair Team migration page
		if ( 'fair_team_member_page_fair-team-migration' === $hook ) {
			$asset_file = include FAIR_TEAM_PLUGIN_DIR . 'build/admin/migration/index.asset.php';

			wp_enqueue_script(
				'fair-team-migration',
				FAIR_TEAM_PLUGIN_URL . 'build/admin/migration/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-team-migration',
				'fair-team',
				FAIR_TEAM_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-team-settings-root"></div>
		<?php
	}

	/**
	 * Render migration page
	 *
	 * @return void
	 */
	public function render_migration_page() {
		?>
		<div id="fair-team-migration-root"></div>
		<?php
	}
}
