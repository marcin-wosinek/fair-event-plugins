<?php
/**
 * Render callback for the Audience Signup block
 *
 * @package FairAudience
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairAudience\Services\AudienceSignupToken;
use FairAudience\Services\ParticipantToken;
use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\QuestionnaireAnswerRepository;
use FairAudience\Database\ParticipantRepository;

// Get block attributes.
$submit_text        = $attributes['submitButtonText'] ?? __( 'Register', 'fair-audience' );
$success_message    = $attributes['successMessage'] ?? __( 'You have been registered successfully!', 'fair-audience' );
$show_instagram     = $attributes['showInstagram'] ?? false;
$show_keep_informed = $attributes['showKeepInformed'] ?? true;
$questions          = $attributes['questions'] ?? array();
$event_date_id_attr = $attributes['eventDateId'] ?? 0;

// Resolve event_date_id: use attribute if set, otherwise auto-detect from current event post.
$event_date_id = '';
if ( $event_date_id_attr > 0 ) {
	$event_date_id = (string) $event_date_id_attr;
} elseif ( class_exists( EventDates::class ) ) {
	$post_id = get_the_ID();
	if ( $post_id && \FairEvents\Database\EventRepository::is_event( $post_id ) ) {
		$event_dates_obj = EventDates::get_by_event_id( $post_id );
		if ( $event_dates_obj ) {
			$event_date_id = (string) $event_dates_obj->id;
		}
	}
}

// Check for participant token (pre-fill mode).
$participant_token_value = get_query_var( 'participant_token', '' );
$linked_participant_id   = 0;
$existing_answers        = array();
$existing_name           = '';
$existing_surname        = '';
$existing_email          = '';
$is_edit_mode            = false;

if ( ! empty( $participant_token_value ) ) {
	$token_data = ParticipantToken::verify( $participant_token_value );
	if ( $token_data ) {
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( $token_data['participant_id'] );
		if ( $participant ) {
			$linked_participant_id = $participant->id;
			$existing_name         = $participant->name;
			$existing_surname      = $participant->surname;
			$existing_email        = $participant->email;
		}
	}
}

// Check for edit mode via token.
$edit_token = get_query_var( 'edit_audience_signup', '' );

if ( ! empty( $edit_token ) ) {
	$submission_id = AudienceSignupToken::verify( $edit_token );
	if ( $submission_id ) {
		$submission_repo = new QuestionnaireSubmissionRepository();
		$submission      = $submission_repo->get_by_id( $submission_id );
		if ( $submission ) {
			$answer_repo = new QuestionnaireAnswerRepository();
			$answers     = $answer_repo->get_by_submission( $submission_id );

			foreach ( $answers as $answer ) {
				$existing_answers[ $answer->question_key ] = array(
					'value' => $answer->answer_value,
					'type'  => $answer->question_type,
				);
			}

			if ( ! $linked_participant_id ) {
				$participant_repo = new ParticipantRepository();
				$participant      = $participant_repo->get_by_id( $submission->participant_id );
				if ( $participant ) {
					$existing_name    = $participant->name;
					$existing_surname = $participant->surname;
					$existing_email   = $participant->email;
				}
			}

			$is_edit_mode = true;
		}
	}
}

// Generate unique ID for this form instance.
$form_id = 'fair-audience-audience-' . wp_unique_id();

// Build wrapper data attributes.
$wrapper_data = array(
	'class'                => 'fair-audience-audience-signup',
	'data-success-message' => esc_attr( $success_message ),
	'data-questions'       => wp_json_encode( $questions ),
);

if ( '' !== $event_date_id ) {
	$wrapper_data['data-event-date-id'] = esc_attr( $event_date_id );
}

$current_post_id = get_the_ID();
if ( $current_post_id ) {
	$wrapper_data['data-post-id'] = (string) $current_post_id;
}

if ( $linked_participant_id ) {
	$wrapper_data['data-participant-id']   = (string) $linked_participant_id;
	$wrapper_data['data-existing-name']    = esc_attr( $existing_name );
	$wrapper_data['data-existing-surname'] = esc_attr( $existing_surname );
	$wrapper_data['data-existing-email']   = esc_attr( $existing_email );
}

if ( $is_edit_mode ) {
	$wrapper_data['data-existing-answers'] = wp_json_encode( $existing_answers );
	if ( ! $linked_participant_id ) {
		$wrapper_data['data-existing-name']    = esc_attr( $existing_name );
		$wrapper_data['data-existing-surname'] = esc_attr( $existing_surname );
		$wrapper_data['data-existing-email']   = esc_attr( $existing_email );
	}
	$wrapper_data['data-edit-mode'] = '1';
}

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes( $wrapper_data );
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-audience-form">
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="audience_name"
				required
				placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
				value="<?php echo esc_attr( $existing_name ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-surname">
				<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-surname"
				name="audience_surname"
				placeholder="<?php echo esc_attr__( 'Enter your last name', 'fair-audience' ); ?>"
				value="<?php echo esc_attr( $existing_surname ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-email">
				<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="audience_email"
				required
				placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
				value="<?php echo esc_attr( $existing_email ); ?>"
			/>
		</p>

		<?php if ( $show_instagram ) : ?>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-instagram">
				<?php echo esc_html__( 'Instagram', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-instagram"
				name="audience_instagram"
				placeholder="<?php echo esc_attr__( '@username', 'fair-audience' ); ?>"
			/>
		</p>
		<?php endif; ?>

		<?php
		foreach ( $questions as $question ) :
			$q_key      = sanitize_key( $question['key'] ?? '' );
			$q_text     = $question['text'] ?? '';
			$q_type     = $question['type'] ?? 'short_text';
			$q_required = ! empty( $question['required'] );
			$q_options  = $question['options'] ?? array();
			$q_id       = esc_attr( $form_id . '-q-' . $q_key );

			$q_existing       = $existing_answers[ $q_key ] ?? null;
			$q_existing_value = $q_existing ? $q_existing['value'] : '';

			$required_html = $q_required
				? ' <span class="required">*</span>'
				: '';
			$required_attr = $q_required ? ' required' : '';
			?>

			<?php if ( 'short_text' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="text"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					value="<?php echo esc_attr( $q_existing_value ); ?>"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'long_text' === $q_type ) : ?>
			<div class="fair-audience-audience-question-group">
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<textarea
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					rows="3"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				><?php echo esc_textarea( $q_existing_value ); ?></textarea>
			</div>

			<?php elseif ( 'number' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="number"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					value="<?php echo esc_attr( $q_existing_value ); ?>"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'date' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="date"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					value="<?php echo esc_attr( $q_existing_value ); ?>"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'select' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<select
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				>
					<option value=""><?php echo esc_html__( 'Select...', 'fair-audience' ); ?></option>
					<?php foreach ( $q_options as $option ) : ?>
					<option value="<?php echo esc_attr( $option ); ?>"<?php selected( $q_existing_value, $option ); ?>><?php echo esc_html( $option ); ?></option>
					<?php endforeach; ?>
				</select>
			</p>

			<?php elseif ( 'radio' === $q_type ) : ?>
			<fieldset class="fair-audience-audience-question-group">
				<legend>
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</legend>
				<?php foreach ( $q_options as $option ) : ?>
				<label class="fair-audience-option-label">
					<input
						type="radio"
						name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
						value="<?php echo esc_attr( $option ); ?>"
						<?php checked( $q_existing_value, $option ); ?>
						<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					/>
					<?php echo esc_html( $option ); ?>
				</label>
				<?php endforeach; ?>
			</fieldset>

				<?php
			elseif ( 'checkbox' === $q_type ) :
				$q_checked_values = array();
				if ( ! empty( $q_existing_value ) ) {
					$decoded = json_decode( $q_existing_value, true );
					if ( is_array( $decoded ) ) {
						$q_checked_values = $decoded;
					}
				}
				?>
			<fieldset class="fair-audience-audience-question-group">
				<legend>
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</legend>
				<?php foreach ( $q_options as $option ) : ?>
				<label class="fair-audience-option-label">
					<input
						type="checkbox"
						name="questionnaire[<?php echo esc_attr( $q_key ); ?>][]"
						value="<?php echo esc_attr( $option ); ?>"
						<?php checked( in_array( $option, $q_checked_values, true ) ); ?>
					/>
					<?php echo esc_html( $option ); ?>
				</label>
				<?php endforeach; ?>
			</fieldset>
			<?php endif; ?>

		<?php endforeach; ?>

		<?php if ( $show_keep_informed ) : ?>
		<div class="fair-audience-audience-checkbox">
			<label>
				<input type="checkbox" name="audience_keep_informed" value="1" />
				<?php echo esc_html__( 'Keep me informed about future events', 'fair-audience' ); ?>
			</label>
		</div>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-audience-submit-button">
				<?php echo esc_html( $is_edit_mode ? __( 'Update Answers', 'fair-audience' ) : $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-audience-message" style="display: none;"></div>
	</form>
</div>
