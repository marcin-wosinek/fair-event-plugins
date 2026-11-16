<?php
/**
 * Booking confirmation email in the common email design.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

defined( 'WPINC' ) || die;

/**
 * Renders a booking email — confirmation or payment failure — through
 * {@see EmailLayout} (#2322).
 *
 * A new class rather than a change to BookingConfirmationEmail::html():
 * older plugins still call that method and keep its output, and a class
 * name older package copies never had cannot be shadowed by them.
 *
 * Takes only pre-translated, pre-escaped strings, like
 * BookingConfirmationEmail, so each plugin keeps its own text domain.
 */
final class BookingConfirmationDocument {

	/**
	 * Build the full HTML email body.
	 *
	 * Accepts every BookingConfirmationEmail::html() key with the same
	 * meaning, plus `alert` (bool): use the failure header color.
	 *
	 * @param array $args See BookingConfirmationEmail::html().
	 * @return string Full HTML document.
	 */
	public static function html( array $args ): string {
		$text = static function ( string $key ) use ( $args ): string {
			return (string) ( $args[ $key ] ?? '' );
		};

		$content = EmailLayout::paragraph( sprintf( $text( 'greeting_template' ), '<strong>' . $text( 'participant_name' ) . '</strong>' ) )
			. EmailLayout::paragraph( $text( 'confirmation_sentence' ) );

		$rows = array();
		foreach (
			array(
				'event_date_label'             => 'event_date_display',
				'registration_reference_label' => 'registration_reference',
				'ticket_type_label'            => 'ticket_type_name',
				'amount_paid_label'            => 'payment_amount_display',
			) as $label_key => $value_key
		) {
			if ( '' !== $text( $value_key ) ) {
				$rows[] = array( $text( $label_key ), $text( $value_key ) );
			}
		}
		if ( ! empty( $rows ) ) {
			$content .= EmailLayout::details_table( $rows );
		}

		$option_names = array_values( (array) ( $args['option_names'] ?? array() ) );
		if ( ! empty( $option_names ) ) {
			$content .= EmailLayout::paragraph( $text( 'selected_options_label' ), EmailLayout::SECTION_LABEL )
				. EmailLayout::item_list( $option_names );
		}

		if ( '' !== $text( 'answers_html' ) ) {
			$content .= EmailLayout::paragraph( $text( 'your_answers_label' ), EmailLayout::SECTION_LABEL )
				. EmailLayout::answers_table( $text( 'answers_html' ) );
		}

		if ( '' !== trim( $text( 'custom_message_html' ) ) ) {
			$content .= EmailLayout::content_block( $text( 'custom_message_html' ) );
		}

		if ( '' !== $text( 'action_url' ) && '' !== $text( 'action_label' ) ) {
			$content .= EmailLayout::paragraph( EmailLayout::text_link( $text( 'action_url' ), $text( 'action_label' ) ) );
		}

		$content .= EmailLayout::paragraph( sprintf( $text( 'sign_off_template' ), '<br>', $text( 'site_name' ) ), EmailLayout::SIGN_OFF );

		return EmailLayout::document(
			$text( 'event_title' ),
			$content,
			EmailLayout::paragraph( $text( 'site_name' ), EmailLayout::FOOTER_TEXT ),
			empty( $args['alert'] ) ? EmailLayout::HEADER_COLOR : EmailLayout::HEADER_COLOR_ALERT
		);
	}
}
