/**
 * Time Block
 *
 * Block for displaying scheduled event time slots.
 */

import { registerBlockType } from "@wordpress/blocks";
import { TextControl, PanelBody } from "@wordpress/components";
import { useBlockProps, InspectorControls } from "@wordpress/block-editor";
import { __ } from "@wordpress/i18n";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons";

/**
 * Register the block
 */
registerBlockType("fair-schedule/time-block", {
  title: __("Time Block", "fair-schedule"),
  description: __("Display a scheduled event time slot", "fair-schedule"),
  category: "widgets",
  icon: <FontAwesomeIcon icon={faClock} />,
  supports: {
    html: false,
  },
  attributes: {
    title: {
      type: "string",
      default: "",
    },
    link: {
      type: "string",
      default: "",
    },
    startHour: {
      type: "string",
      default: "09:00",
    },
    endHour: {
      type: "string",
      default: "10:00",
    },
  },

  /**
   * Block edit function
   */
  edit: ({ attributes, setAttributes }) => {
    const blockProps = useBlockProps({
      className: "time-block",
    });

    const { title, link, startHour, endHour } = attributes;

    return (
      <>
        <InspectorControls>
          <PanelBody title={__("Time Block Settings", "fair-schedule")}>
            <TextControl
              label={__("Link", "fair-schedule")}
              value={link}
              onChange={(value) => setAttributes({ link: value })}
              placeholder={__("https://example.com", "fair-schedule")}
              type="url"
            />
            <TextControl
              label={__("Start Hour", "fair-schedule")}
              value={startHour}
              onChange={(value) => setAttributes({ startHour: value })}
              type="time"
            />
            <TextControl
              label={__("End Hour", "fair-schedule")}
              value={endHour}
              onChange={(value) => setAttributes({ endHour: value })}
              type="time"
            />
          </PanelBody>
        </InspectorControls>
        <div {...blockProps}>
          <div className="time-block-editor">
            <TextControl
              label={__("Title", "fair-schedule")}
              value={title}
              onChange={(value) => setAttributes({ title: value })}
              placeholder={__("Event title", "fair-schedule")}
            />
          </div>
          <div className="time-block-preview">
            <div className="time-slot">
              <span className="time-range">
                {startHour} - {endHour}
              </span>
              {title && (
                <h5 className="event-title">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      {title}
                    </a>
                  ) : (
                    title
                  )}
                </h5>
              )}
            </div>
          </div>
        </div>
      </>
    );
  },

  /**
   * Block save function
   */
  save: ({ attributes }) => {
    const blockProps = useBlockProps.save({
      className: "time-block",
    });

    const { title, link, startHour, endHour } = attributes;

    return (
      <div {...blockProps}>
        <div className="time-slot">
          <span className="time-range">
            {startHour} - {endHour}
          </span>
          {title && (
            <h5 className="event-title">
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {title}
                </a>
              ) : (
                title
              )}
            </h5>
          )}
        </div>
      </div>
    );
  },
});

