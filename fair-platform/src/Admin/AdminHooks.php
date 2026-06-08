<?php
/**
 * Admin Hooks for Fair Platform
 *
 * @package FairPlatform
 */

namespace FairPlatform\Admin;

use FairPlatform\Admin\ConnectionsPage;
use FairPlatform\Admin\InstagramConnectionsPage;
use FairPlatform\Core\Features;

defined( 'WPINC' ) || die;

/**
 * Admin hooks class
 */
class AdminHooks {
	/**
	 * Initialize admin hooks
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_styles' ) );
	}

	/**
	 * Register admin menu
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		add_menu_page(
			__( 'Fair Platform Settings', 'fair-platform' ),
			__( 'Fair Platform', 'fair-platform' ),
			'manage_options',
			'fair-platform-settings',
			array( $this, 'render_settings_page' ),
			'dashicons-admin-plugins',
			'20.4'
		);

		add_submenu_page(
			'fair-platform-settings',
			__( 'Connection Logs', 'fair-platform' ),
			__( 'Connections', 'fair-platform' ),
			'manage_options',
			'fair-platform-connections',
			array( $this, 'render_connections_page' )
		);

		add_submenu_page(
			'fair-platform-settings',
			__( 'Instagram Connections', 'fair-platform' ),
			__( 'Instagram', 'fair-platform' ),
			'manage_options',
			'fair-platform-instagram-connections',
			array( $this, 'render_instagram_connections_page' )
		);

		add_submenu_page(
			'fair-platform-settings',
			__( 'Features', 'fair-platform' ),
			__( 'Features', 'fair-platform' ),
			'manage_options',
			'fair-platform-features',
			array( $this, 'render_features_page' )
		);
	}

	/**
	 * Render features page (bundled-translations toggle).
	 *
	 * @return void
	 */
	public function render_features_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-platform' ) );
		}

		if ( isset( $_POST['fair_platform_features_nonce'] ) &&
			wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fair_platform_features_nonce'] ) ), 'fair_platform_features' ) ) {
			$submitted = isset( $_POST['fair_platform_features'] ) && is_array( $_POST['fair_platform_features'] )
				? wp_unslash( $_POST['fair_platform_features'] )
				: array();
			update_option( Features::OPTION, Features::sanitize_option( $submitted ) );
			add_settings_error( 'fair_platform_features', 'saved', __( 'Features saved.', 'fair-platform' ), 'success' );
		}

		$features = Features::all();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Fair Platform - Features', 'fair-platform' ); ?></h1>
			<?php settings_errors( 'fair_platform_features' ); ?>
			<form method="post">
				<?php wp_nonce_field( 'fair_platform_features', 'fair_platform_features_nonce' ); ?>
				<table class="form-table" role="presentation">
					<tbody>
						<?php foreach ( $features as $key => $meta ) : ?>
							<?php
							if ( $meta['always_on'] ) {
								continue; }
							?>
							<tr>
								<th scope="row"><?php echo esc_html( $meta['label'] ); ?></th>
								<td>
									<label>
										<input
											type="checkbox"
											name="fair_platform_features[<?php echo esc_attr( $key ); ?>]"
											value="1"
											<?php checked( $meta['enabled'] ); ?>
											<?php disabled( $meta['forced'] ); ?>
										/>
										<?php echo esc_html( $meta['description'] ); ?>
									</label>
									<?php if ( $meta['forced'] ) : ?>
										<p class="description">
											<?php esc_html_e( 'Forced by a wp-config constant — change it there.', 'fair-platform' ); ?>
										</p>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<?php submit_button( __( 'Save Features', 'fair-platform' ) ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Enqueue admin styles
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_styles( $hook ) {
		$allowed_hooks = array(
			'toplevel_page_fair-platform-settings',
			'fair-platform_page_fair-platform-connections',
			'fair-platform_page_fair-platform-instagram-connections',
		);

		if ( ! in_array( $hook, $allowed_hooks, true ) ) {
			return;
		}

		wp_enqueue_style(
			'fair-platform-admin',
			\FAIR_PLATFORM_URL . 'assets/admin.css',
			array(),
			\FAIR_PLATFORM_VERSION
		);

		// Enqueue React admin page scripts for connections page.
		if ( 'fair-platform_page_fair-platform-connections' === $hook ) {
			$asset_file = \FAIR_PLATFORM_DIR . 'build/admin/connections/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset = include $asset_file;

				wp_enqueue_script(
					'fair-platform-connections',
					\FAIR_PLATFORM_URL . 'build/admin/connections/index.js',
					$asset['dependencies'],
					$asset['version'],
					true
				);

				wp_enqueue_style(
					'fair-platform-connections',
					\FAIR_PLATFORM_URL . 'build/admin/connections/index.css',
					array( 'wp-components' ),
					$asset['version']
				);
			}
		}

		// Enqueue React admin page scripts for Instagram connections page.
		if ( 'fair-platform_page_fair-platform-instagram-connections' === $hook ) {
			$asset_file = \FAIR_PLATFORM_DIR . 'build/admin/instagram-connections/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset = include $asset_file;

				wp_enqueue_script(
					'fair-platform-instagram-connections',
					\FAIR_PLATFORM_URL . 'build/admin/instagram-connections/index.js',
					$asset['dependencies'],
					$asset['version'],
					true
				);

				wp_enqueue_style(
					'fair-platform-instagram-connections',
					\FAIR_PLATFORM_URL . 'build/admin/instagram-connections/index.css',
					array( 'wp-components' ),
					$asset['version']
				);
			}
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		// Check user capabilities.
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-platform' ) );
		}

		$mollie_configured = defined( 'MOLLIE_CLIENT_ID' ) && defined( 'MOLLIE_CLIENT_SECRET' );
		$client_id         = $mollie_configured ? MOLLIE_CLIENT_ID : '';
		$has_secret        = $mollie_configured && ! empty( MOLLIE_CLIENT_SECRET );

		// Get recent transients for debugging.
		global $wpdb;
		$transients = $wpdb->get_results(
			"SELECT option_name, option_value
			FROM {$wpdb->options}
			WHERE option_name LIKE '_transient_mollie_oauth_%'
			ORDER BY option_id DESC
			LIMIT 10"
		);

		include __DIR__ . '/settings-page.php';
	}

	/**
	 * Render connections page
	 *
	 * @return void
	 */
	public function render_connections_page() {
		ConnectionsPage::render();
	}

	/**
	 * Render Instagram connections page
	 *
	 * @return void
	 */
	public function render_instagram_connections_page() {
		InstagramConnectionsPage::render();
	}
}
