<?php
/**
 * Plugin core class for Fair Timetable
 *
 * @package FairTimetable
 */

namespace FairTimetable\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-timetable', false, 'fair-timetable/languages' );
				}
			}
		);

		add_action(
			'admin_init',
			function () {
				register_setting(
					'fair_timetable_settings',
					Features::OPTION,
					array(
						'type'              => 'object',
						'sanitize_callback' => array( Features::class, 'sanitize_option' ),
						'default'           => array(),
					)
				);
			}
		);

		if ( is_admin() ) {
			add_action( 'admin_menu', array( $this, 'register_settings_page' ) );
		}

		$this->load_hooks();
	}

	/**
	 * Register the Fair Timetable settings page.
	 *
	 * @return void
	 */
	public function register_settings_page() {
		add_options_page(
			__( 'Fair Timetable', 'fair-timetable' ),
			__( 'Fair Timetable', 'fair-timetable' ),
			'manage_options',
			'fair-timetable-settings',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Render the Fair Timetable settings page (Features-only).
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-timetable' ) );
		}

		if ( isset( $_POST['fair_timetable_features_nonce'] ) &&
			wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fair_timetable_features_nonce'] ) ), 'fair_timetable_features' ) ) {
			$submitted = isset( $_POST['fair_timetable_features'] ) && is_array( $_POST['fair_timetable_features'] )
				? wp_unslash( $_POST['fair_timetable_features'] )
				: array();
			update_option( Features::OPTION, Features::sanitize_option( $submitted ) );
			add_settings_error( 'fair_timetable_features', 'saved', __( 'Features saved.', 'fair-timetable' ), 'success' );
		}

		$features = Features::all();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Fair Timetable - Features', 'fair-timetable' ); ?></h1>
			<?php settings_errors( 'fair_timetable_features' ); ?>
			<form method="post">
				<?php wp_nonce_field( 'fair_timetable_features', 'fair_timetable_features_nonce' ); ?>
				<table class="form-table" role="presentation">
					<tbody>
						<?php foreach ( $features as $key => $meta ) : ?>
							<?php
							if ( $meta['always_on'] ) {
								continue;
							}
							?>
							<tr>
								<th scope="row"><?php echo esc_html( $meta['label'] ); ?></th>
								<td>
									<label>
										<input
											type="checkbox"
											name="fair_timetable_features[<?php echo esc_attr( $key ); ?>]"
											value="1"
											<?php checked( $meta['enabled'] ); ?>
											<?php disabled( $meta['forced'] ); ?>
										/>
										<?php echo esc_html( $meta['description'] ); ?>
									</label>
									<?php if ( $meta['forced'] ) : ?>
										<p class="description">
											<?php esc_html_e( 'Forced by a wp-config constant — change it there.', 'fair-timetable' ); ?>
										</p>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<?php submit_button( __( 'Save Features', 'fair-timetable' ) ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairTimetable\Hooks\BlockHooks();
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization
	}
}
