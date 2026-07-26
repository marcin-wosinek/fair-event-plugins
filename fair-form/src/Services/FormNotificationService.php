<?php
/**
 * Form Notification Service
 *
 * Sends the admin-facing "new form submission" notification configured on the
 * Fair Form block. Owns its own mail path (wp_mail()) and deferral hook so
 * the notification works with fair-form alone — it no longer depends on
 * fair-audience's EmailService.
 *
 * @package FairForm
 */

namespace FairForm\Services;

use FairForm\Database\QuestionnaireSubmissionRepository;
use FairForm\Database\QuestionnaireAnswerRepository;

defined( 'WPINC' ) || die;

/**
 * Builds and sends the admin notification email for a Fair Form submission.
 */
class FormNotificationService {

	/**
	 * Cron hook used to dispatch the deferred notification.
	 */
	const DEFERRED_HOOK = 'fair_form_send_deferred_notification';

	/**
	 * Queue the notification to be sent after the current request, off the
	 * critical path. Mirrors EmailService::defer() — a slow/unreachable mail
	 * transport must not make the submit request hang.
	 *
	 * Passing the submission ID (rather than the raw answers) keeps the
	 * scheduled args unique per submission, so wp_schedule_single_event()'s
	 * dedupe window can't collapse two different visitors' notifications into
	 * one.
	 *
	 * @param int    $submission_id Questionnaire submission ID.
	 * @param string $to_email      Notification recipient.
	 * @return void
	 */
	public static function defer( int $submission_id, string $to_email ): void {
		wp_schedule_single_event( time(), self::DEFERRED_HOOK, array( $submission_id, $to_email ) );
	}

	/**
	 * Cron callback: send a previously deferred notification.
	 *
	 * @param int    $submission_id Questionnaire submission ID.
	 * @param string $to_email      Notification recipient.
	 * @return void
	 */
	public static function run_deferred( int $submission_id, string $to_email ): void {
		( new self() )->send( $submission_id, $to_email );
	}

	/**
	 * Resolve the notification recipient configured on the Fair Form block
	 * that produced this submission.
	 *
	 * Walks the post's blocks (dereferencing reusable `core/block` patterns)
	 * looking for a `fair-audience/fair-form` block. When a form ID was
	 * submitted, matches on the block's `formId` attribute; otherwise takes
	 * the first Fair Form block found. Forms placed outside `post_content`
	 * (e.g. an FSE template part) are not found — a deliberate trade-off, see
	 * ticket #1212.
	 *
	 * @param int    $post_id Post ID the form was submitted from.
	 * @param string $form_id Stable form UUID from the block attribute, or ''.
	 * @return string Sanitized recipient email, or '' when unresolved.
	 */
	public static function resolve_notification_email( int $post_id, string $form_id ): string {
		if ( $post_id <= 0 ) {
			self::notify_failure( 'unresolved_recipient', $post_id, $form_id );
			return '';
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			self::notify_failure( 'unresolved_recipient', $post_id, $form_id );
			return '';
		}

		$block = self::find_form_block( parse_blocks( $post->post_content ), $form_id );

		if ( ! $block ) {
			self::notify_failure( 'unresolved_recipient', $post_id, $form_id );
			return '';
		}

		$email = ! empty( $block['attrs']['notificationEmail'] )
			? sanitize_email( $block['attrs']['notificationEmail'] )
			: '';

		if ( '' === $email ) {
			self::notify_failure( 'unresolved_recipient', $post_id, $form_id );
		}

		return $email;
	}

	/**
	 * Recursively search parsed blocks for the matching Fair Form block,
	 * dereferencing `core/block` (reusable/synced pattern) references.
	 *
	 * @param array  $blocks  Parsed blocks (from parse_blocks()).
	 * @param string $form_id Form UUID to match, or '' to take the first block found.
	 * @return array|null The matching block, or null.
	 */
	private static function find_form_block( array $blocks, string $form_id ) {
		foreach ( $blocks as $block ) {
			$block_name = $block['blockName'] ?? '';

			if ( 'core/block' === $block_name ) {
				$ref_id = (int) ( $block['attrs']['ref'] ?? 0 );
				if ( $ref_id > 0 ) {
					$reusable_post = get_post( $ref_id );
					if ( $reusable_post ) {
						$found = self::find_form_block( parse_blocks( $reusable_post->post_content ), $form_id );
						if ( $found ) {
							return $found;
						}
					}
				}
				continue;
			}

			if ( 'fair-audience/fair-form' === $block_name ) {
				if ( '' === $form_id || ( $block['attrs']['formId'] ?? '' ) === $form_id ) {
					return $block;
				}
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = self::find_form_block( $block['innerBlocks'], $form_id );
				if ( $found ) {
					return $found;
				}
			}
		}

		return null;
	}

	/**
	 * Rehydrate a submission and send its notification email.
	 *
	 * @param int    $submission_id Questionnaire submission ID.
	 * @param string $to_email      Notification recipient.
	 * @return bool Success.
	 */
	public function send( int $submission_id, string $to_email ): bool {
		if ( empty( $to_email ) || ! is_email( $to_email ) ) {
			return false;
		}

		$submission = ( new QuestionnaireSubmissionRepository() )->get_by_id( $submission_id );
		if ( ! $submission ) {
			self::notify_failure( 'submission_not_found', 0, '' );
			return false;
		}

		$answers         = ( new QuestionnaireAnswerRepository() )->get_by_submission( $submission_id );
		$submitter_email = $this->extract_submitter_email( $answers );
		$post_id         = (int) ( $submission->post_id ?? 0 );

		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		$page_title = '';
		if ( $post_id > 0 ) {
			$post = get_post( $post_id );
			if ( $post ) {
				$page_title = $post->post_title;
			}
		}

		$subject = sprintf(
			/* translators: %s: site name */
			__( 'New form submission — %s', 'fair-form' ),
			$site_name
		);

		$submitter_html = '';
		if ( '' !== $submitter_email ) {
			$submitter_html = '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html__( 'Email', 'fair-form' ) . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;"><a href="mailto:' . esc_attr( $submitter_email ) . '" style="color: #0073aa;">' . esc_html( $submitter_email ) . '</a></td>
			</tr>';
		}

		$answers_html = $this->render_answer_rows( $answers );

		$context_html = '';
		if ( '' !== $page_title ) {
			$context_html = '<p style="margin: 0 0 20px 0; font-size: 16px;">'
				. sprintf(
					/* translators: %s: page title */
					esc_html__( 'Page: %s', 'fair-form' ),
					'<strong>' . esc_html( $page_title ) . '</strong>'
				)
				. '</p>';
		}

		$message = '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . esc_html__( 'A new form submission has been received.', 'fair-form' ) . '
							</p>

							' . $context_html . '

							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $submitter_html . $answers_html . '
							</table>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0;">
								' . esc_html( $site_name ) . '
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';

		$sent = $this->deliver( $to_email, $subject, $message );

		if ( ! $sent ) {
			self::notify_failure( 'mail_failed', $post_id, (string) $submission->form_id );
		}

		return $sent;
	}

	/**
	 * Find the first email-type answer, mirroring
	 * FairFormController::extract_email_from_answers() for the rehydrated
	 * (deferred) send path.
	 *
	 * @param QuestionnaireAnswer[] $answers Submission answers.
	 * @return string Submitter email, or '' when no email question was answered.
	 */
	private function extract_submitter_email( array $answers ): string {
		foreach ( $answers as $answer ) {
			if ( 'email' === $answer->question_type && '' !== $answer->answer_value ) {
				return $answer->answer_value;
			}
		}

		return '';
	}

	/**
	 * Render questionnaire answers as `<tr>` rows for the notification table.
	 *
	 * Ported from EmailService::render_answer_rows() (fair-audience). Handles
	 * both array-shaped answers and QuestionnaireAnswer model objects;
	 * `multiselect` values are JSON-decoded to a comma-joined list;
	 * `file_upload` values resolve to a clickable attachment link when
	 * possible.
	 *
	 * @param array $answers Array of answer arrays or QuestionnaireAnswer objects.
	 * @return string `<tr>...</tr>` markup, or '' when nothing renderable.
	 */
	private function render_answer_rows( array $answers ): string {
		$rows = '';
		foreach ( $answers as $answer ) {
			$question_text = is_object( $answer ) ? ( $answer->question_text ?? '' ) : ( $answer['question_text'] ?? '' );
			$question_type = is_object( $answer ) ? ( $answer->question_type ?? '' ) : ( $answer['question_type'] ?? '' );
			$answer_value  = is_object( $answer ) ? ( $answer->answer_value ?? '' ) : ( $answer['answer_value'] ?? '' );

			if ( 'file_upload' === $question_type ) {
				$value_html = '';
				if ( is_numeric( $answer_value ) ) {
					$attachment_id  = (int) $answer_value;
					$attachment_url = wp_get_attachment_url( $attachment_id );
					if ( $attachment_url ) {
						$label      = get_the_title( $attachment_id );
						$value_html = '<a href="' . esc_url( $attachment_url ) . '" style="color: #0073aa;">'
							. esc_html( $label ? $label : basename( $attachment_url ) )
							. '</a>';
					}
				}
				if ( '' === $value_html ) {
					// No resolvable attachment — skip rather than show a stray ID.
					continue;
				}

				$rows .= '<tr>
					<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html( $question_text ) . '</td>
					<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . $value_html . '</td>
				</tr>';
				continue;
			}

			$decoded = json_decode( (string) $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$rows .= '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . esc_html( $question_text ) . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . esc_html( $answer_value ) . '</td>
			</tr>';
		}

		return $rows;
	}

	/**
	 * Send the notification via wp_mail(). Graceful degradation only —
	 * wp_mail() returning false is a normal outcome (no mail transport
	 * configured), never an exception.
	 *
	 * @param string $to_email Recipient email address.
	 * @param string $subject  Email subject.
	 * @param string $message  Full HTML body.
	 * @return bool Whether wp_mail() accepted the message.
	 */
	private function deliver( string $to_email, string $subject, string $message ): bool {
		$content_type = static function () {
			return 'text/html';
		};

		add_filter( 'wp_mail_content_type', $content_type );
		$result = wp_mail( $to_email, $subject, $this->append_branding_footer( $message ) );
		remove_filter( 'wp_mail_content_type', $content_type );

		return (bool) $result;
	}

	/**
	 * Append the opt-in "Powered by Fair Event Plugins" footer when
	 * fair-audience is active and the site owner has enabled it. A no-op
	 * (message unchanged) otherwise, so output stays identical to the
	 * previous fair-audience-owned send path when that plugin is present.
	 *
	 * @param string $message Full HTML email body.
	 * @return string Message with the footer injected, or unchanged.
	 */
	private function append_branding_footer( string $message ): string {
		if ( ! class_exists( '\FairAudience\Services\Branding' ) ) {
			return $message;
		}

		$footer = \FairAudience\Services\Branding::email_footer_html();
		if ( '' === $footer ) {
			return $message;
		}

		if ( false === strpos( $message, '</body>' ) ) {
			return $message . $footer;
		}

		return str_replace( '</body>', $footer . '</body>', $message );
	}

	/**
	 * Fire the graceful-degradation failure hook and, under WP_DEBUG, log the
	 * reason. No admin-visible notice yet — see ticket #1212 follow-ups.
	 *
	 * @param string $reason  Machine-readable reason: 'unresolved_recipient', 'submission_not_found', or 'mail_failed'.
	 * @param int    $post_id Post ID the form was submitted from, when known.
	 * @param string $form_id Form UUID, when known.
	 * @return void
	 */
	private static function notify_failure( string $reason, int $post_id, string $form_id ): void {
		do_action( 'fair_form_notification_failed', $reason, $post_id, $form_id );

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( sprintf( 'fair-form: notification not sent (%s) for post_id=%d form_id=%s', $reason, $post_id, $form_id ) );
		}
	}
}
