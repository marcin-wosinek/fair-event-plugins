<?php
/**
 * Admin Pages for Fair Audience Experimental
 *
 * Registers the experimental settings page as a submenu under the
 * fair-audience menu. Feature-bundle admin pages are added here as each
 * bundle is migrated out of fair-audience.
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
		}
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
}
