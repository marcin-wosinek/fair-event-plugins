<?php
/**
 * Manage Subscription Template
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Services\ManageSubscriptionPage;
use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Database\ParticipantCategoryRepository;

// $page is the request outcome from ManageSubscriptionPage::handle(), set by
// Plugin::handle_manage_subscription() before it includes this file.
$participant = $page['participant'];
$view        = $page['view'];

// Whether the weekly summary preference should be shown at all.
$weekly_enabled = \FairAudience\Services\WeeklyDigestMailer::is_enabled();

// Load mailing categories for display.
$mailing_category_ids = get_option( 'fair_audience_mailing_category_ids', array() );
$mailing_categories   = array();
$participant_cat_ids  = array();

if ( ! empty( $mailing_category_ids ) && ManageSubscriptionPage::VIEW_MANAGE === $view ) {
	$mailing_categories = get_terms(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'include'    => array_map( 'intval', $mailing_category_ids ),
			'orderby'    => 'name',
			'order'      => 'ASC',
		)
	);
	if ( is_wp_error( $mailing_categories ) ) {
		$mailing_categories = array();
	}

	$participant_cat_ids = ( new ParticipantCategoryRepository() )->get_category_ids_by_participant( $participant->id );
}

$site_name_header = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

/**
 * Print the deletion confirmation: whose data, what changes, what stays, and
 * the two actions. Shown in the dialog, and as a page when the dialog cannot
 * be used.
 *
 * @param bool $in_dialog Whether it is printed inside the dialog.
 */
$render_delete_confirmation = static function ( $in_dialog ) use ( $page, $participant ) {
	$scope = ManageSubscriptionPage::deletion_scope();
	?>
	<form method="post" class="fair-audience-delete-confirmation-form">
		<h2 class="fair-audience-delete-confirmation-title" id="fair-audience-delete-confirmation-title">
			<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
		</h2>
		<div id="fair-audience-delete-confirmation-description">
			<p>
				<?php
				if ( ! empty( $participant->email ) ) {
					echo esc_html(
						sprintf(
							/* translators: %s: email address of the profile */
							__( 'Delete the personal data stored for %s?', 'fair-audience' ),
							$participant->email
						)
					);
				} else {
					echo esc_html__( 'Delete the personal data stored for this profile?', 'fair-audience' );
				}
				?>
			</p>
			<p class="fair-audience-delete-confirmation-list-title">
				<?php echo esc_html__( 'What is deleted:', 'fair-audience' ); ?>
			</p>
			<ul>
				<?php foreach ( $scope['changed'] as $sentence ) : ?>
					<li><?php echo esc_html( $sentence ); ?></li>
				<?php endforeach; ?>
			</ul>
			<p class="fair-audience-delete-confirmation-list-title">
				<?php echo esc_html__( 'What is kept:', 'fair-audience' ); ?>
			</p>
			<ul>
				<?php foreach ( $scope['kept'] as $sentence ) : ?>
					<li><?php echo esc_html( $sentence ); ?></li>
				<?php endforeach; ?>
			</ul>
			<p class="fair-audience-delete-confirmation-warning">
				<?php echo esc_html__( 'This cannot be undone.', 'fair-audience' ); ?>
			</p>
		</div>
		<input type="hidden" name="confirm_delete_my_data" value="1">
		<input type="hidden" name="delete_confirmation" value="<?php echo esc_attr( $page['confirmation_proof'] ); ?>">
		<div class="fair-audience-delete-confirmation-actions">
			<?php if ( $in_dialog ) : ?>
				<button type="button" class="fair-audience-delete-confirmation-cancel" data-fair-audience-delete-cancel autofocus>
					<?php echo esc_html__( 'Cancel', 'fair-audience' ); ?>
				</button>
			<?php else : ?>
				<a class="fair-audience-delete-confirmation-cancel" href="<?php echo esc_url( ManageSubscriptionToken::get_url( (int) $participant->id ) ); ?>">
					<?php echo esc_html__( 'Cancel', 'fair-audience' ); ?>
				</a>
			<?php endif; ?>
			<button type="submit" class="fair-audience-delete-confirmation-submit" data-submitting-label="<?php echo esc_attr__( 'Deleting…', 'fair-audience' ); ?>">
				<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
			</button>
		</div>
	</form>
	<?php
};
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name_header ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<style>
	.fair-audience-subscription-container {
		max-width: 600px;
		margin: 60px auto;
		padding: 40px 20px;
	}

	.fair-audience-subscription-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-subscription-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1e1e1e;
		text-align: center;
	}

	.fair-audience-subscription-subtitle {
		font-size: 14px;
		color: #757575;
		margin-bottom: 24px;
		text-align: center;
	}

	.fair-audience-subscription-message {
		padding: 12px 16px;
		border-radius: 4px;
		margin-bottom: 24px;
		font-size: 14px;
	}

	.fair-audience-subscription-message.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.fair-audience-subscription-message.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.fair-audience-subscription-options {
		margin-bottom: 24px;
	}

	.fair-audience-subscription-option {
		display: flex;
		align-items: flex-start;
		padding: 16px;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 12px;
		cursor: pointer;
		transition: border-color 0.2s, background-color 0.2s;
	}

	.fair-audience-subscription-option:hover {
		border-color: #0073aa;
		background-color: #f8f9fa;
	}

	.fair-audience-subscription-option.selected {
		border-color: #0073aa;
		background-color: #e7f3ff;
	}

	.fair-audience-subscription-option input[type="radio"] {
		margin-right: 12px;
		margin-top: 3px;
		flex-shrink: 0;
	}

	.fair-audience-subscription-option-content {
		flex: 1;
	}

	.fair-audience-subscription-option-title {
		font-weight: 600;
		color: #1e1e1e;
		margin-bottom: 4px;
	}

	.fair-audience-subscription-option-description {
		font-size: 14px;
		color: #757575;
		line-height: 1.5;
	}

	.fair-audience-subscription-submit {
		display: block;
		width: 100%;
		background-color: #0073aa;
		color: #fff;
		border: none;
		padding: 14px 24px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.fair-audience-subscription-submit:hover {
		background-color: #005a87;
	}

	.fair-audience-subscription-footer {
		margin-top: 24px;
		text-align: center;
	}

	.fair-audience-subscription-link {
		color: #0073aa;
		text-decoration: none;
	}

	.fair-audience-subscription-link:hover {
		text-decoration: underline;
	}

	.fair-audience-subscription-weekly-summary {
		margin: -8px 0 24px 44px;
	}

	.fair-audience-subscription-categories {
		margin-bottom: 24px;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
	}

	.fair-audience-subscription-categories-title {
		font-size: 16px;
		font-weight: 600;
		color: #1e1e1e;
		margin: 0 0 12px 0;
	}

	.fair-audience-subscription-category-label {
		display: flex;
		align-items: center;
		padding: 8px 0;
		cursor: pointer;
		font-size: 14px;
		color: #1e1e1e;
	}

	.fair-audience-subscription-category-label input[type="checkbox"] {
		margin-right: 10px;
		flex-shrink: 0;
	}

	.fair-audience-error-container {
		text-align: center;
	}

	.fair-audience-error-icon {
		font-size: 48px;
		color: #d63638;
		margin-bottom: 20px;
	}

	.fair-audience-subscription-delete-section {
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid #e0e0e0;
	}

	.fair-audience-subscription-delete-title {
		font-size: 16px;
		font-weight: 600;
		color: #721c24;
		margin: 0 0 8px 0;
	}

	.fair-audience-subscription-delete-description {
		font-size: 14px;
		color: #757575;
		margin-bottom: 16px;
		line-height: 1.5;
	}

	.fair-audience-subscription-delete-button {
		display: block;
		width: 100%;
		background-color: #d63638;
		color: #fff;
		border: none;
		padding: 14px 24px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.fair-audience-subscription-delete-button:hover {
		background-color: #b32d2e;
	}

	.fair-audience-delete-dialog {
		width: calc(100% - 32px);
		max-width: 560px;
		max-height: calc(100% - 32px);
		padding: 0;
		border: none;
		border-radius: 8px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
		color: #1e1e1e;
		overflow-wrap: anywhere;
	}

	.fair-audience-delete-dialog::backdrop {
		background: rgba(0, 0, 0, 0.35);
	}

	.fair-audience-delete-dialog .fair-audience-delete-confirmation-form {
		padding: 24px;
	}

	.fair-audience-delete-confirmation-form {
		font-size: 14px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.fair-audience-delete-confirmation-title {
		font-size: 20px;
		font-weight: 600;
		color: #1e1e1e;
		margin: 0 0 16px 0;
	}

	.fair-audience-delete-confirmation-form p {
		margin: 0 0 12px 0;
	}

	.fair-audience-delete-confirmation-form ul {
		margin: 0 0 16px 0;
		padding-left: 20px;
	}

	.fair-audience-delete-confirmation-form li {
		margin-bottom: 4px;
	}

	.fair-audience-delete-confirmation-form .fair-audience-delete-confirmation-list-title {
		font-weight: 600;
		margin-bottom: 4px;
	}

	.fair-audience-delete-confirmation-form .fair-audience-delete-confirmation-warning {
		font-weight: 600;
		color: #721c24;
	}

	.fair-audience-delete-confirmation-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 24px;
	}

	.fair-audience-delete-confirmation-cancel,
	.fair-audience-delete-confirmation-submit {
		box-sizing: border-box;
		padding: 10px 20px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		line-height: 1.5;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
	}

	.fair-audience-delete-confirmation-cancel {
		background-color: #fff;
		color: #0073aa;
		border: 1px solid #0073aa;
	}

	.fair-audience-delete-confirmation-cancel:hover {
		background-color: #f0f6fc;
	}

	.fair-audience-delete-confirmation-submit {
		background-color: #d63638;
		color: #fff;
		border: 1px solid #d63638;
	}

	.fair-audience-delete-confirmation-submit:hover {
		background-color: #b32d2e;
		border-color: #b32d2e;
	}

	.fair-audience-delete-confirmation-cancel:disabled,
	.fair-audience-delete-confirmation-submit:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.fair-audience-delete-confirmation-cancel:focus-visible,
	.fair-audience-delete-confirmation-submit:focus-visible,
	.fair-audience-subscription-delete-button:focus-visible {
		outline: 2px solid #1e1e1e;
		outline-offset: 2px;
	}

	@media (max-width: 480px) {
		.fair-audience-delete-confirmation-actions {
			flex-direction: column-reverse;
		}
	}
</style>

<div class="fair-audience-subscription-container">
	<div class="fair-audience-subscription-box">
		<?php if ( ManageSubscriptionPage::VIEW_INVALID === $view ) : ?>
			<div class="fair-audience-error-container">
				<div class="fair-audience-error-icon">&#10007;</div>
				<h1 class="fair-audience-subscription-title">
					<?php echo esc_html__( 'Invalid Link', 'fair-audience' ); ?>
				</h1>
				<p class="fair-audience-subscription-message error">
					<?php echo esc_html( $page['message'] ); ?>
				</p>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php else : ?>
			<h1 class="fair-audience-subscription-title">
				<?php echo esc_html__( 'Manage Your Subscription', 'fair-audience' ); ?>
			</h1>
			<?php if ( ! empty( $participant->email ) ) : ?>
				<p class="fair-audience-subscription-subtitle">
					<?php echo esc_html( $participant->email ); ?>
				</p>
			<?php endif; ?>

			<?php if ( ! empty( $page['message'] ) ) : ?>
				<div class="fair-audience-subscription-message <?php echo esc_attr( $page['message_type'] ); ?>" role="<?php echo 'error' === $page['message_type'] ? 'alert' : 'status'; ?>">
					<?php echo esc_html( $page['message'] ); ?>
				</div>
			<?php endif; ?>

			<?php if ( ManageSubscriptionPage::VIEW_CONFIRM_DELETE === $view ) : ?>
				<div class="fair-audience-delete-confirmation">
					<?php $render_delete_confirmation( false ); ?>
				</div>
			<?php elseif ( ManageSubscriptionPage::VIEW_MANAGE === $view ) : ?>
				<form method="post">
					<div class="fair-audience-subscription-options">
						<label class="fair-audience-subscription-option <?php echo 'marketing' === $participant->email_profile ? 'selected' : ''; ?>">
							<input type="radio" name="email_profile" value="marketing" <?php checked( $participant->email_profile, 'marketing' ); ?>>
							<div class="fair-audience-subscription-option-content">
								<div class="fair-audience-subscription-option-title">
									<?php echo esc_html__( 'All emails', 'fair-audience' ); ?>
								</div>
								<div class="fair-audience-subscription-option-description">
									<?php echo esc_html__( 'Receive event invitations, photos, polls, and other updates.', 'fair-audience' ); ?>
								</div>
							</div>
						</label>

						<label class="fair-audience-subscription-option <?php echo 'minimal' === $participant->email_profile ? 'selected' : ''; ?>">
							<input type="radio" name="email_profile" value="minimal" <?php checked( $participant->email_profile, 'minimal' ); ?>>
							<div class="fair-audience-subscription-option-content">
								<div class="fair-audience-subscription-option-title">
									<?php echo esc_html__( 'Essential emails only', 'fair-audience' ); ?>
								</div>
								<div class="fair-audience-subscription-option-description">
									<?php echo esc_html__( 'Only receive emails about events you signed up for (photos, polls, confirmations). No promotional emails.', 'fair-audience' ); ?>
								</div>
							</div>
						</label>
					</div>

					<?php if ( $weekly_enabled ) : ?>
						<div
							class="fair-audience-subscription-weekly-summary"
							id="fair-audience-weekly-summary-wrap"
							<?php echo 'marketing' !== $participant->email_profile ? 'style="display:none;"' : ''; ?>
						>
							<label class="fair-audience-subscription-category-label">
								<input
									type="checkbox"
									name="weekly_summary"
									id="fair-audience-weekly-summary"
									<?php checked( empty( $participant->weekly_summary_opt_out ) ); ?>
									<?php disabled( 'marketing' !== $participant->email_profile ); ?>
								/>
								<?php echo esc_html__( 'Weekly summary of upcoming events', 'fair-audience' ); ?>
							</label>
						</div>
					<?php endif; ?>

					<?php if ( ! empty( $mailing_categories ) ) : ?>
						<div class="fair-audience-subscription-categories">
							<h2 class="fair-audience-subscription-categories-title">
								<?php echo esc_html__( 'I want to receive updates about:', 'fair-audience' ); ?>
							</h2>
							<?php foreach ( $mailing_categories as $category ) : ?>
								<label class="fair-audience-subscription-category-label">
									<input
										type="checkbox"
										name="mailing_categories[]"
										value="<?php echo esc_attr( $category->term_id ); ?>"
										<?php checked( in_array( (int) $category->term_id, $participant_cat_ids, true ) ); ?>
									/>
									<?php echo esc_html( $category->name ); ?>
								</label>
							<?php endforeach; ?>
						</div>
					<?php endif; ?>

					<button type="submit" class="fair-audience-subscription-submit">
						<?php echo esc_html__( 'Save Preferences', 'fair-audience' ); ?>
					</button>
				</form>

				<div class="fair-audience-subscription-footer">
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
						<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
					</a>
				</div>

				<div class="fair-audience-subscription-delete-section">
					<h2 class="fair-audience-subscription-delete-title">
						<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
					</h2>
					<p class="fair-audience-subscription-delete-description">
						<?php echo esc_html__( 'Delete your contact details and preferences from your profile. Some records, such as tickets and payments, are kept. This cannot be undone.', 'fair-audience' ); ?>
					</p>
					<form method="post" data-fair-audience-delete-trigger>
						<input type="hidden" name="delete_my_data" value="1">
						<button type="submit" class="fair-audience-subscription-delete-button" aria-haspopup="dialog">
							<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
						</button>
					</form>
					<dialog
						class="fair-audience-delete-dialog"
						aria-labelledby="fair-audience-delete-confirmation-title"
						aria-describedby="fair-audience-delete-confirmation-description"
						data-fair-audience-delete-dialog
						hidden
					>
						<?php $render_delete_confirmation( true ); ?>
					</dialog>
				</div>
			<?php else : ?>
				<div class="fair-audience-subscription-footer">
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
						<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
					</a>
				</div>
			<?php endif; ?>
		<?php endif; ?>
	</div>
</div>

<script>
	document.addEventListener('DOMContentLoaded', function() {
		var options = document.querySelectorAll('.fair-audience-subscription-option');
		var weeklySummaryWrap = document.getElementById('fair-audience-weekly-summary-wrap');
		var weeklySummaryInput = document.getElementById('fair-audience-weekly-summary');

		function updateWeeklySummaryVisibility(profile) {
			if (!weeklySummaryWrap) {
				return;
			}
			var isMarketing = 'marketing' === profile;
			weeklySummaryWrap.style.display = isMarketing ? '' : 'none';
			if (weeklySummaryInput) {
				weeklySummaryInput.disabled = !isMarketing;
			}
		}

		options.forEach(function(option) {
			var radio = option.querySelector('input[type="radio"]');
			radio.addEventListener('change', function() {
				options.forEach(function(opt) {
					opt.classList.remove('selected');
				});
				if (radio.checked) {
					option.classList.add('selected');
					updateWeeklySummaryVisibility(radio.value);
				}
			});
		});
	});
</script>

<?php wp_footer(); ?>
</body>
</html>
