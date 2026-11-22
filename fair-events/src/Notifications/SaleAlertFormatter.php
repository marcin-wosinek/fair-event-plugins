<?php
/**
 * Telegram ticket sale alert text.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEventsShared\Helpers\DisplayText;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * Builds the Telegram HTML message of one ticket sale (#2448): the event,
 * its dates, each ticket type with its quantity and the charged total.
 *
 * Every value is decoded once ({@see DisplayText}) and then escaped for
 * Telegram HTML, translated text included, so a title such as
 * `La&nbsp;Mutable` reads "La Mutable" and tag-like text stays text. The
 * buyer is never named.
 */
class SaleAlertFormatter {
	/**
	 * Most dates and ticket types listed before the rest are counted.
	 */
	public const MAX_LINES = 10;

	/**
	 * The message.
	 *
	 * @param array $sale `{ title, dates: string[], tickets: { name, quantity }[], amount, currency }`.
	 * @return string Telegram HTML.
	 */
	public static function html( array $sale ) {
		$title = DisplayText::event_title( (string) ( $sale['title'] ?? '' ), __( '(untitled event)', 'fair-events' ) );

		$lines   = array();
		$lines[] = '<b>' . self::text( __( 'New ticket sale', 'fair-events' ) ) . '</b>';
		$lines[] = '<b>' . DisplayText::html( $title ) . '</b>';
		foreach ( self::capped( (array) ( $sale['dates'] ?? array() ) ) as $date ) {
			$lines[] = self::text( $date );
		}
		$lines[] = '';

		$tickets = array();
		foreach ( (array) ( $sale['tickets'] ?? array() ) as $ticket ) {
			$name      = DisplayText::decode( (string) ( $ticket['name'] ?? '' ) );
			$tickets[] = sprintf(
				/* translators: 1: number of tickets, 2: ticket type name */
				__( '%1$d × %2$s', 'fair-events' ),
				(int) ( $ticket['quantity'] ?? 0 ),
				'' !== trim( $name ) ? $name : __( 'Ticket', 'fair-events' )
			);
		}
		foreach ( self::capped( $tickets ) as $ticket ) {
			$lines[] = DisplayText::html( $ticket );
		}
		$lines[] = '';

		$lines[] = self::text(
			sprintf(
				/* translators: %s: amount charged with its currency, for example 24.00 EUR */
				__( 'Total: %s', 'fair-events' ),
				Money::format_display( (float) ( $sale['amount'] ?? 0 ), (string) ( $sale['currency'] ?? '' ) )
			)
		);

		return implode( "\n", $lines );
	}

	/**
	 * Decode stored or translated text once and escape it for Telegram HTML.
	 *
	 * @param string $value Text.
	 * @return string
	 */
	private static function text( $value ) {
		return DisplayText::html( DisplayText::decode( (string) $value ) );
	}

	/**
	 * At most {@see self::MAX_LINES} lines, the rest counted in one more.
	 *
	 * @param string[] $lines Plain text lines.
	 * @return string[]
	 */
	private static function capped( array $lines ) {
		$lines = array_values( $lines );
		if ( count( $lines ) <= self::MAX_LINES ) {
			return $lines;
		}
		$more    = count( $lines ) - self::MAX_LINES + 1;
		$lines   = array_slice( $lines, 0, self::MAX_LINES - 1 );
		$lines[] = sprintf(
			/* translators: %d: number of further lines not shown */
			_n( 'and %d more', 'and %d more', $more, 'fair-events' ),
			$more
		);
		return $lines;
	}
}
