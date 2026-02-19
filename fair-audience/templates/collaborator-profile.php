<?php
/**
 * Collaborator Profile Registration Template
 *
 * Public form for collaborators to register their profile data.
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Models\Participant;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Services\EmailService;

$participant_repository = new ParticipantRepository();
$token_repository       = new EmailConfirmationTokenRepository();
$email_service          = new EmailService();

$result = array(
	'success'           => false,
	'confirmation_sent' => false,
	'message'           => '',
	'type'              => '',
);

// Preserve form values for re-display on error.
$form_values = array(
	'name'      => '',
	'surname'   => '',
	'email'     => '',
	'instagram' => '',
	'marketing' => false,
);

// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Public form, no auth required.
if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'POST' === $_SERVER['REQUEST_METHOD'] && isset( $_POST['collaborator_profile_submit'] ) ) {
	// phpcs:disable WordPress.Security.NonceVerification.Missing -- Public form, no auth required.
	$form_values['name']      = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
	$form_values['surname']   = isset( $_POST['surname'] ) ? sanitize_text_field( wp_unslash( $_POST['surname'] ) ) : '';
	$form_values['email']     = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
	$form_values['instagram'] = isset( $_POST['instagram'] ) ? sanitize_text_field( wp_unslash( $_POST['instagram'] ) ) : '';
	$form_values['marketing'] = isset( $_POST['marketing'] );
	// phpcs:enable WordPress.Security.NonceVerification.Missing

	// Strip leading @ from Instagram handle.
	$form_values['instagram'] = ltrim( $form_values['instagram'], '@' );

	// Validate.
	if ( empty( $form_values['name'] ) ) {
		$result['type']    = 'error';
		$result['message'] = __( 'Name is required.', 'fair-audience' );
	} elseif ( ! empty( $form_values['email'] ) && ! is_email( $form_values['email'] ) ) {
		$result['type']    = 'error';
		$result['message'] = __( 'Please enter a valid email address.', 'fair-audience' );
	} elseif ( ! empty( $form_values['email'] ) && $participant_repository->get_by_email( $form_values['email'] ) ) {
		$result['type']    = 'error';
		$result['message'] = __( 'A profile with this email already exists.', 'fair-audience' );
	} else {
		// If email provided, create as pending and send confirmation.
		// If no email, create as confirmed directly.
		$has_email = ! empty( $form_values['email'] );

		$participant = new Participant(
			array(
				'name'          => $form_values['name'],
				'surname'       => $form_values['surname'],
				'email'         => $form_values['email'],
				'instagram'     => $form_values['instagram'],
				'status'        => $has_email ? 'pending' : 'confirmed',
				'email_profile' => $form_values['marketing'] ? 'marketing' : 'minimal',
			)
		);

		if ( ! $participant->save() ) {
			$result['type']    = 'error';
			$result['message'] = __( 'Failed to register profile. Please try again.', 'fair-audience' );
		} elseif ( $has_email ) {
			// Send confirmation email.
			$token = $token_repository->create_token( $participant->id );

			if ( $token && $email_service->send_confirmation_email( $participant, $token->token ) ) {
				$result['success']           = true;
				$result['confirmation_sent'] = true;
			} else {
				$result['success'] = true;
			}
		} else {
			$result['success'] = true;
		}
	}
}

get_header();
?>

<style>
	.fair-audience-profile-container {
		max-width: 600px;
		margin: 60px auto;
		padding: 40px 20px;
	}

	.fair-audience-profile-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-profile-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1e1e1e;
		text-align: center;
	}

	.fair-audience-profile-subtitle {
		font-size: 14px;
		color: #757575;
		margin-bottom: 24px;
		text-align: center;
	}

	.fair-audience-profile-message {
		padding: 12px 16px;
		border-radius: 4px;
		margin-bottom: 24px;
		font-size: 14px;
	}

	.fair-audience-profile-message.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.fair-audience-profile-message.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.fair-audience-profile-field {
		margin-bottom: 16px;
	}

	.fair-audience-profile-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: #1e1e1e;
		margin-bottom: 6px;
	}

	.fair-audience-profile-label .required {
		color: #d63638;
	}

	.fair-audience-profile-input {
		display: block;
		width: 100%;
		padding: 10px 12px;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 14px;
		color: #1e1e1e;
		box-sizing: border-box;
	}

	.fair-audience-profile-input:focus {
		border-color: #0073aa;
		outline: none;
		box-shadow: 0 0 0 1px #0073aa;
	}

	.fair-audience-profile-checkbox {
		display: flex;
		align-items: flex-start;
		margin-bottom: 24px;
		margin-top: 8px;
	}

	.fair-audience-profile-checkbox input[type="checkbox"] {
		margin-right: 8px;
		margin-top: 3px;
		flex-shrink: 0;
	}

	.fair-audience-profile-checkbox-label {
		font-size: 14px;
		color: #1e1e1e;
		cursor: pointer;
	}

	.fair-audience-profile-submit {
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

	.fair-audience-profile-submit:hover {
		background-color: #005a87;
	}

	.fair-audience-profile-success-icon {
		font-size: 48px;
		color: #00a32a;
		margin-bottom: 20px;
		text-align: center;
	}

	.fair-audience-profile-footer {
		margin-top: 24px;
		text-align: center;
	}

	.fair-audience-profile-link {
		color: #0073aa;
		text-decoration: none;
	}

	.fair-audience-profile-link:hover {
		text-decoration: underline;
	}
</style>

<div class="fair-audience-profile-container">
	<div class="fair-audience-profile-box">
		<?php if ( $result['success'] ) : ?>
			<div class="fair-audience-profile-success-icon">&#10003;</div>
			<h1 class="fair-audience-profile-title">
				<?php echo esc_html__( 'Profile Registered', 'fair-audience' ); ?>
			</h1>
			<?php if ( $result['confirmation_sent'] ) : ?>
				<p class="fair-audience-profile-subtitle">
					<?php echo esc_html__( 'Please check your email to confirm your subscription.', 'fair-audience' ); ?>
				</p>
			<?php else : ?>
				<p class="fair-audience-profile-subtitle">
					<?php echo esc_html__( 'Thank you for registering your profile.', 'fair-audience' ); ?>
				</p>
			<?php endif; ?>
			<div class="fair-audience-profile-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-profile-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php else : ?>
			<h1 class="fair-audience-profile-title">
				<?php echo esc_html__( 'Collaborator Profile', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-profile-subtitle">
				<?php echo esc_html__( 'Register your profile information.', 'fair-audience' ); ?>
			</p>

			<?php if ( ! empty( $result['message'] ) ) : ?>
				<div class="fair-audience-profile-message <?php echo esc_attr( $result['type'] ); ?>">
					<?php echo esc_html( $result['message'] ); ?>
				</div>
			<?php endif; ?>

			<form method="post">
				<input type="hidden" name="collaborator_profile_submit" value="1">

				<div class="fair-audience-profile-field">
					<label class="fair-audience-profile-label" for="fair-audience-name">
						<?php echo esc_html__( 'Name', 'fair-audience' ); ?>
						<span class="required">*</span>
					</label>
					<input
						type="text"
						id="fair-audience-name"
						name="name"
						class="fair-audience-profile-input"
						value="<?php echo esc_attr( $form_values['name'] ); ?>"
						required
					>
				</div>

				<div class="fair-audience-profile-field">
					<label class="fair-audience-profile-label" for="fair-audience-surname">
						<?php echo esc_html__( 'Surname', 'fair-audience' ); ?>
					</label>
					<input
						type="text"
						id="fair-audience-surname"
						name="surname"
						class="fair-audience-profile-input"
						value="<?php echo esc_attr( $form_values['surname'] ); ?>"
					>
				</div>

				<div class="fair-audience-profile-field">
					<label class="fair-audience-profile-label" for="fair-audience-email">
						<?php echo esc_html__( 'Email', 'fair-audience' ); ?>
					</label>
					<input
						type="email"
						id="fair-audience-email"
						name="email"
						class="fair-audience-profile-input"
						value="<?php echo esc_attr( $form_values['email'] ); ?>"
					>
				</div>

				<div class="fair-audience-profile-field">
					<label class="fair-audience-profile-label" for="fair-audience-instagram">
						<?php echo esc_html__( 'Instagram', 'fair-audience' ); ?>
					</label>
					<input
						type="text"
						id="fair-audience-instagram"
						name="instagram"
						class="fair-audience-profile-input"
						value="<?php echo esc_attr( $form_values['instagram'] ); ?>"
						placeholder="@username"
					>
				</div>

				<div class="fair-audience-profile-checkbox">
					<input
						type="checkbox"
						id="fair-audience-marketing"
						name="marketing"
						value="1"
						<?php checked( $form_values['marketing'] ); ?>
					>
					<label class="fair-audience-profile-checkbox-label" for="fair-audience-marketing">
						<?php echo esc_html__( 'Receive marketing emails', 'fair-audience' ); ?>
					</label>
				</div>

				<button type="submit" class="fair-audience-profile-submit">
					<?php echo esc_html__( 'Register Profile', 'fair-audience' ); ?>
				</button>
			</form>
		<?php endif; ?>
	</div>
</div>

<?php
get_footer();
?>
