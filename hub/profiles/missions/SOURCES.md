# Where the ISS mission file comes from

`iss.json` draws the International Space Station as NASA describes it, as the setting for a
**simulated** crew (the four Astrum crewmates, not the real crew). Every room, and what it is
used for, is taken from the NASA sentence quoted here. All pages were read on 14 November 2026.
Saved copies of the pages are outside the repository, in `~/Desktop/NASA/side/iss/raw/`.

Sources, with the short name used below:

- **Guide**: NASA, *International Space Station Utilization Guide* (NP-2015-05-022-JSC),
  https://www.nasa.gov/wp-content/uploads/2017/09/np-2015-05-022-jsc-iss-guide-2015-update-111015-508c.pdf
- **Elements**: NASA, International Space Station Assembly Elements,
  https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/
- **Facts**: NASA, Space Station Facts and Figures,
  https://www.nasa.gov/international-space-station/space-station-facts-and-figures/
- **Module pages**: https://www.nasa.gov/international-space-station/<module>/ (named per row)
- **Blogs**: NASA Space Station blog posts on Nauka (2021-07-29), Prichal (2021-11-26), Bishop (2020-12-21)
- **Litho**: NASA, ISS Litho (LG-2023-05-010-JSC),
  https://www.nasa.gov/wp-content/uploads/2023/06/lg-2023-05-010-jsc-iss-litho-updates.pdf
- **Diagram**: NASA, International Space Station Configuration (2023),
  https://www.nasa.gov/wp-content/uploads/2023/05/iss-blowout-updated-view-2023-300.png (used to check the drawing, not measured)

## Rooms (where the demo crew can be)

| Module | Template | The fact | NASA's sentence | Source |
|---|---|---|---|---|
| Harmony (Node 2) | quarters | crew sleep here | "In addition, Node 2 provides crew quarters for 4 crew members as well as vital functional resources for the operation of the connected elements" | Guide p. 32 |
| Unity (Node 1) | galley | crew eat here | "Dinner in Node 1 with Russian cosmonaut Oleg Kotov, NASA astronaut Mike Hopkins and JAXA astronaut Koichi Wakata." and "Accommodations—including the waste management compartment and toilet, the galley, individual crew sleep compartments, and some of the exercise facilities—are located in the Service Module (SM), Node 1, Node 2, Node 3, and the U.S. Laboratory." | Guide p. 43 |
| Tranquility (Node 3) | exercise | crew exercise here | "Tranquility provides workout facilities for astronauts including a treadmilll and an advanced resistive exercise device." | Module page tranquility-module |
| Destiny | lab | science | "The U.S. Laboratory Module, called Destiny, is the primary research laboratory for U.S. payloads" | Module page destiny-laboratory-module; Guide p. 27 |
| Columbus | lab | science | "Columbus is a multifunctional pressurized laboratory permanently attached to the Harmony Module." | Module page columbus-laboratory-module |
| Kibo | lab | science | "Kibo, Japanese for "hope," is a space research facility enabling astronauts to investigate a variety of space phenomena." | Module page japanese-experiment-module-kibo |
| Quest | airlock | spacewalks | "The airlock is the primary path for spacewalk entry and departure for astronauts wearing U.S. spacesuits." | Module page quest-airlock |
| Cupola | observation | looking out, robotics | "The cupola is a small module designed for the observation of operations outside the station such as robotic activities, the approach of vehicles, and spacewalks." | Module page cupola |
| Zvezda | galley | meals, Russian segment living quarters | "The module provides station living quarters, life support systems, electrical power distribution, data processing systems, flight control systems and propulsion systems." and "prepare for a meal in the Service Module galley." | Module page zvezda-service-module; Guide p. 43 |

## Arrangement (which module is fixed where)

Frame of the file: +x aft, +y zenith, +z port, −z starboard; Destiny's middle is the origin.

| Module | Attached to | NASA's sentence | Source |
|---|---|---|---|
| Harmony | forward of Destiny | "Node 2 is attached to the forward end of the U.S. laboratory" | Guide p. 32 |
| Columbus | Harmony, starboard | "connects Columbus, the European laboratory, on the starboard side" | Guide p. 32 |
| Kibo | Harmony, port | "Kibo, the Japanese laboratory, on the port side" | Guide p. 32 |
| PMA-2 | Harmony, forward | "the Pressurized Mating Adaptor 2 (PMA-2) on the forward side" | Guide p. 32 |
| PMA-3 | Harmony, zenith | "PMA-3 will be relocated to the Node 2 zenith port" (done since; Harmony "provides international docking adapters on its space-facing and forward ports") | Guide p. 37; module page harmony-module |
| Kibo logistics module | Kibo, top | "It is attached to the top of the main pressurized section of Kibo." | Elements |
| Unity | aft of Destiny; Zarya aft of it | "Node 1 is shown with the Russian segment FGB to the right (aft), the U.S. Laboratory to the left (fore), the U.S. Airlock at the bottom (starboard)" | Guide p. 31 |
| Quest | Unity, starboard | (same sentence) | Guide p. 31 |
| Tranquility | Unity, port | "Tranquility is connected to the port side of the Unity node" | Module page tranquility-module |
| Cupola | Tranquility, nadir | "is berthed to the Earth facing side of Node-3" | Guide p. 35 |
| PMM (Leonardo) | Tranquility, forward | "relocated from its original port on the Earth-facing side of the Unity module to the Tranquility module's forward port" | Module page permanent-multipurpose-module |
| BEAM | Tranquility, aft | "installed it on the Tranquility module's aft port" | Module page bigelow-expandable-activity-module-beam |
| Bishop | Tranquility, port | "installed on the port side of the Tranquility module" | Blog 2020-12-21 |
| Z1 truss | Unity (zenith) | "Node 1's six ports provide berthing connections to the Z1 Truss, U.S. Laboratory Module, Airlock, Node 3 and PMA/FGB." ("Z stands for Zenith") | Guide p. 31, p. 53 |
| Zvezda | aft of Zarya | "Zvezda was the third module attached to the orbital outpost when it automatically docked to the Zarya module" | Module page zvezda-service-module |
| Poisk | Zvezda, zenith | "The Poisk module is pictured attached to the Zvezda service module's space-facing port." | Elements |
| Nauka | Zvezda, nadir | "arrived at the International Space Station's Zvezda service module on the Earth-facing side of the Russian segment" | Blog 2021-07-29 |
| Prichal | Nauka, nadir | "They docked to the Nauka module on the Earth-facing side of the Russian segment" | Blog 2021-11-26 |
| Rassvet | Zarya, nadir | "The module is attached to the Earth-facing port of the Zarya module." | Module page rassvet-mini-research-module |

## Sizes NASA states (used as given)

Destiny 8.5 m long, 4.3 m diameter; Harmony and Tranquility 6.7 m, 4.3 m; Unity 5.5 m, 4.3 m;
Columbus 6.9 m, 4.5 m; Kibo 11.2 m, 4.4 m, its logistics module 4.2 m, 4.4 m, its exposed
facility 5.6 × 5 × 4 m; Quest 5.5 m long, 4.0 m wide; Cupola 1.5 m high, 3 m diameter, "six side
windows and a direct nadir viewing window"; PMM 6.67 m, 4.5 m; PMAs 1.86 m long, 1.9 m and
1.37 m across their ends; Zarya 12.99 m (the guide prints "12,990 m"), 4.1 m maximum diameter,
arrays spanning 24.4 m; Zvezda 13.1 m, 4.2 m, arrays spanning 29.7 m; Poisk 4.9 m, 2.55 m;
Rassvet 6.0 m, 2.35 m (all Guide pp. 27–42); Nauka "43-foot long" (Elements).
Truss "310 feet (94 meters)" (Facts); "The ISS structure measures 95 m (311 ft) from the P6 to
S6 trusses" (Guide p. 78); "The ITS reaches 108.5 meters (356 feet) in length across the extended
solar arrays." (module page integrated-truss-structure); "Solar Array Length: 239 feet across
both longitudinally aligned arrays (73 meters)" and "8 solar arrays" (Facts); "Each Solar Array
Wing (SAW) has 2 blankets" (Guide p. 50); "six large Heat Rejection Subsystem (HRS) radiators"
and "a single independent PhotoVoltaic Thermal Control System (PVTCS) radiator for each of the
four pairs of solar array wings" (Guide p. 52); "The radiators were delivered with the S1, S3, S6
and P1, P3 and P4 trusses." (module page integrated-truss-structure).

## Marked `"approx": true` in iss.json (NASA's text gives no number or position)

- Where along its parent each radial port sits (Columbus, Kibo, PMA-3, Quest, Tranquility,
  Cupola, PMM): drawn at the parent's middle.
- Kibo's logistics module position along Kibo; the exposed facility's height offset.
- Sizes of IDA-2, IDA-3, BEAM, Bishop, Prichal, Z1; Nauka's diameter; where Poisk, Nauka and
  Rassvet sit along Zvezda and Zarya.
- How the truss's 94 m divide into segments, its cross-section (3.6 m) and its height above
  Destiny (S0 sits on Destiny; the mounting is not drawn).
- Solar wings: width (11.6 m), root offset, sun-tracking angle; which wing of each pair carries
  an IROSA, and the IROSAs' size and angle.
- HRS and photovoltaic radiators: size, direction and angle.
- Zvezda's and Zarya's array widths and places along the modules.

## Delay to Earth

No figure on these pages. The file uses 1 second as an honest stand-in: station-to-ground voice
is near real time.

## Not drawn

Visiting vehicles, Canadarm2, Dextre, the Mobile Base System, external payloads (AMS, ELCs,
ESPs, Bartolomeo), Nauka's radiator and European Robotic Arm.
