<?php
/**
 * Settings Page Template
 *
 * @package FairPlatform
 */

defined( 'WPINC' ) || die;
?>

<div class="wrap fair-platform-settings">
	<h1><?php esc_html_e( 'Fair Platform - Mollie OAuth Settings', 'fair-platform' ); ?></h1>

	<div class="fair-platform-grid">
		<!-- Configuration Status -->
		<div class="fair-platform-card">
			<h2><?php esc_html_e( 'Configuration Status', 'fair-platform' ); ?></h2>

			<table class="widefat">
				<tbody>
					<tr>
						<td><strong><?php esc_html_e( 'Client ID', 'fair-platform' ); ?></strong></td>
						<td>
							<?php if ( ! empty( $client_id ) ) : ?>
								<span class="status-indicator status-success">✓</span>
								<code><?php echo esc_html( substr( $client_id, 0, 15 ) . '...' ); ?></code>
							<?php else : ?>
								<span class="status-indicator status-error">✗</span>
								<span class="status-text"><?php esc_html_e( 'Not configured', 'fair-platform' ); ?></span>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td><strong><?php esc_html_e( 'Client Secret', 'fair-platform' ); ?></strong></td>
						<td>
							<?php if ( $has_secret ) : ?>
								<span class="status-indicator status-success">✓</span>
								<span class="status-text"><?php esc_html_e( 'Configured', 'fair-platform' ); ?></span>
							<?php else : ?>
								<span class="status-indicator status-error">✗</span>
								<span class="status-text"><?php esc_html_e( 'Not configured', 'fair-platform' ); ?></span>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td><strong><?php esc_html_e( 'OAuth Endpoints', 'fair-platform' ); ?></strong></td>
						<td>
							<?php
							$authorize_url = home_url( '/oauth/authorize' );
							$callback_url  = home_url( '/oauth/callback' );
							$refresh_url   = home_url( '/oauth/refresh' );
							?>
							<div class="endpoint-list">
								<div><code><?php echo esc_html( $authorize_url ); ?></code></div>
								<div><code><?php echo esc_html( $callback_url ); ?></code></div>
								<div><code><?php echo esc_html( $refresh_url ); ?></code></div>
							</div>
						</td>
					</tr>
				</tbody>
			</table>

			<?php if ( ! $mollie_configured ) : ?>
				<div class="notice notice-error inline">
					<p>
						<strong><?php esc_html_e( 'Mollie OAuth is not configured.', 'fair-platform' ); ?></strong>
					</p>
					<p><?php esc_html_e( 'Add the following to your wp-config.php:', 'fair-platform' ); ?></p>
					<pre>define('MOLLIE_CLIENT_ID', 'app_xxxxxxxxxxxxx');
define('MOLLIE_CLIENT_SECRET', 'xxxxxxxxxxxxx');</pre>
					<p>
						<?php
						echo wp_kses_post(
							sprintf(
								/* translators: %s: README.md URL */
								__( 'See <a href="%s" target="_blank">README.md</a> for setup instructions.', 'fair-platform' ),
								'https://github.com/marcinwosinek/fair-event-plugins/blob/main/fair-platform/README.md'
							)
						);
						?>
					</p>
				</div>
			<?php endif; ?>
		</div>

		<!-- Test Connection -->
		<div class="fair-platform-card">
			<h2><?php esc_html_e( 'Test OAuth Connection', 'fair-platform' ); ?></h2>

			<?php if ( $mollie_configured ) : ?>
				<p><?php esc_html_e( 'Test the OAuth flow by initiating a connection.', 'fair-platform' ); ?></p>

				<form method="post" action="">
					<?php wp_nonce_field( 'fair_platform_test_oauth', 'fair_platform_nonce' ); ?>
					<input type="hidden" name="action" value="test_oauth" />
					<p>
						<button type="submit" class="button button-primary">
							<?php esc_html_e( 'Test OAuth Flow', 'fair-platform' ); ?>
						</button>
					</p>
				</form>

				<?php
				// Handle test OAuth request.
				if ( isset( $_POST['action'] ) && 'test_oauth' === $_POST['action'] ) {
					if ( ! isset( $_POST['fair_platform_nonce'] ) || ! wp_verify_nonce( $_POST['fair_platform_nonce'], 'fair_platform_test_oauth' ) ) {
						echo '<div class="notice notice-error"><p>' . esc_html__( 'Invalid nonce.', 'fair-platform' ) . '</p></div>';
					} else {
						$test_url = add_query_arg(
							array(
								'site_id'    => base64_encode( 'test-site' ),
								'return_url' => admin_url( 'admin.php?page=fair-platform-settings&test=complete' ),
								'site_name'  => 'Test Site',
								'site_url'   => home_url(),
							),
							home_url( '/oauth/authorize' )
						);

						echo '<div class="notice notice-info"><p>';
						echo esc_html__( 'Redirecting to Mollie OAuth...', 'fair-platform' );
						echo '</p></div>';
						echo '<script>window.location.href = ' . wp_json_encode( $test_url ) . ';</script>';
					}
				}

				// Show test result.
				if ( isset( $_GET['test'] ) && 'complete' === $_GET['test'] ) {
					if ( isset( $_GET['mollie_access_token'] ) ) {
						echo '<div class="notice notice-success"><p>';
						echo '<strong>' . esc_html__( 'OAuth test successful!', 'fair-platform' ) . '</strong><br>';
						echo esc_html__( 'Access token received:', 'fair-platform' ) . ' ';
						echo '<code>' . esc_html( substr( sanitize_text_field( $_GET['mollie_access_token'] ), 0, 20 ) . '...' ) . '</code>';
						echo '</p></div>';
					} elseif ( isset( $_GET['error'] ) ) {
						echo '<div class="notice notice-error"><p>';
						echo '<strong>' . esc_html__( 'OAuth test failed:', 'fair-platform' ) . '</strong><br>';
						echo esc_html( sanitize_text_field( $_GET['error'] ) );
						if ( isset( $_GET['error_description'] ) ) {
							echo '<br>' . esc_html( sanitize_text_field( $_GET['error_description'] ) );
						}
						echo '</p></div>';
					}
				}
				?>

			<?php else : ?>
				<div class="notice notice-warning inline">
					<p><?php esc_html_e( 'Configure Mollie credentials first to test the connection.', 'fair-platform' ); ?></p>
				</div>
			<?php endif; ?>
		</div>

		<!-- Recent OAuth Activity -->
		<div class="fair-platform-card full-width">
			<h2><?php esc_html_e( 'Recent OAuth Activity', 'fair-platform' ); ?></h2>

			<?php if ( ! empty( $transients ) ) : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'State Token', 'fair-platform' ); ?></th>
							<th><?php esc_html_e( 'Site Info', 'fair-platform' ); ?></th>
							<th><?php esc_html_e( 'Created', 'fair-platform' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $transients as $transient ) : ?>
							<?php
							$state = str_replace( '_transient_mollie_oauth_', '', $transient->option_name );
							$data  = maybe_unserialize( $transient->option_value );
							?>
							<tr>
								<td><code><?php echo esc_html( substr( $state, 0, 16 ) . '...' ); ?></code></td>
								<td>
									<?php if ( is_array( $data ) ) : ?>
										<?php echo esc_html( $data['site_name'] ?? 'Unknown' ); ?><br>
										<small><?php echo esc_html( $data['site_url'] ?? '' ); ?></small>
									<?php else : ?>
										<em><?php esc_html_e( 'Invalid data', 'fair-platform' ); ?></em>
									<?php endif; ?>
								</td>
								<td>
									<?php
									if ( is_array( $data ) && isset( $data['timestamp'] ) ) {
										echo esc_html( human_time_diff( $data['timestamp'], time() ) . ' ago' );
									} else {
										echo '—';
									}
									?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php else : ?>
				<p class="description"><?php esc_html_e( 'No recent OAuth activity.', 'fair-platform' ); ?></p>
			<?php endif; ?>
		</div>

		<!-- Documentation -->
		<div class="fair-platform-card full-width">
			<h2><?php esc_html_e( 'Documentation', 'fair-platform' ); ?></h2>

			<h3><?php esc_html_e( 'Setup Instructions', 'fair-platform' ); ?></h3>
			<ol>
				<li>
					<strong><?php esc_html_e( 'Create Mollie Partner Account', 'fair-platform' ); ?></strong><br>
					<a href="https://www.mollie.com/partners" target="_blank">https://www.mollie.com/partners</a>
				</li>
				<li>
					<strong><?php esc_html_e( 'Create OAuth Application', 'fair-platform' ); ?></strong><br>
					<?php esc_html_e( 'In Mollie Dashboard → Developers → Your Apps', 'fair-platform' ); ?><br>
					<?php esc_html_e( 'Redirect URI:', 'fair-platform' ); ?> <code><?php echo esc_html( home_url( '/oauth/callback' ) ); ?></code><br>
					<?php esc_html_e( 'Scopes:', 'fair-platform' ); ?> <code>payments.read payments.write refunds.read refunds.write organizations.read profiles.read</code>
				</li>
				<li>
					<strong><?php esc_html_e( 'Add Credentials to wp-config.php', 'fair-platform' ); ?></strong>
					<pre>define('MOLLIE_CLIENT_ID', 'app_xxxxxxxxxxxxx');
define('MOLLIE_CLIENT_SECRET', 'xxxxxxxxxxxxx');</pre>
				</li>
			</ol>

			<h3><?php esc_html_e( 'How It Works', 'fair-platform' ); ?></h3>
			<p><?php esc_html_e( 'This plugin acts as an OAuth proxy between WordPress sites and Mollie:', 'fair-platform' ); ?></p>
			<ol>
				<li><?php esc_html_e( 'User clicks "Connect Mollie" on their WordPress site', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'Site redirects to fair-event-plugins.com/oauth/authorize', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'This plugin redirects to Mollie for authorization', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'User authorizes the connection on Mollie', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'Mollie redirects back to fair-event-plugins.com/oauth/callback', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'Plugin exchanges authorization code for access tokens', 'fair-platform' ); ?></li>
				<li><?php esc_html_e( 'Tokens are sent back to the WordPress site', 'fair-platform' ); ?></li>
			</ol>
		</div>
	</div>
</div>
