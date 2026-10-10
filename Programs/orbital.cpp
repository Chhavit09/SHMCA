#include <iostream>
#include <fstream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <cmath>
#include <unistd.h>

using namespace std;

// OOP Unit 2: Fundamentals of Operator Overloading

struct Vector3 
{
    double x, y, z;
    Vector3() { x = 0; y = 0; z = 0; }
    Vector3(double a, double b, double c) { x = a; y = b; z = c; }
    Vector3 operator+(const Vector3 &o) const { 
        return Vector3(x + o.x, y + o.y, z + o.z); 
    } Vector3 operator-(const Vector3 &o) const { 
        return Vector3(x - o.x, y - o.y, z - o.z); 
    } Vector3 operator*(double s) const { 
        return Vector3(x * s, y * s, z * s); 
    }
};

inline double dist3D(Vector3 a, Vector3 b) 
{
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    double dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

#include "Queues_DSA.h"
#include "AVL_Tree.h"
#include "Satellites_OOP.h"
#include "FlightComputer.h"
#include "Chaos_Engine.h"

int REPAIR_DURATION_TICKS = 20;

Satellite* createSatelliteAroundEarth(int id, string name, int typeChoice) 
{
    double orbitRadius = 4200 + 600 + rand() % 400; 
    double angle = (rand() % 360) * 3.14159265 / 180.0;
    double speed = 6.5 + (rand() % 20) / 10.0;
    
    Vector3 pos(orbitRadius * cos(angle), orbitRadius * sin(angle), (rand() % 200 - 100) / 10.0);
    Vector3 vel(-sin(angle) * speed, cos(angle) * speed, 0);

    if (typeChoice == 1) 
    {
        return new CommunicationSatellite(id, name, pos, vel);
    } 
    else 
    {
        return new ImagingSatellite(id, name, pos, vel);
    }
}

int main() 
{
    srand((unsigned) time(0));
    cout << "---------------------------------\n";
    cout << " ORBITAL - Earth Orbit Edition\n";
    cout << "---------------------------------\n\n";

    int numSats;
    cout << "How many satellites in Earth orbit? (1-6): ";
    while (!(cin >> numSats) || numSats < 1 || numSats > 6) {
        cout << "Invalid input! Please enter a number between 1 and 6: ";
        cin.clear();
        cin.ignore(256, '\n');
    }
    vector<Satellite*> satellites;
    for (int i = 0; i < numSats; i++) 
    {
        string name;
        int typeChoice;
        cout << "\nSatellite #" << (i + 1) << " Name (no spaces): ";
        cin >> name;
        cout << "Type (1: Communication, 2: Imaging): ";
        while (!(cin >> typeChoice) || (typeChoice != 1 && typeChoice != 2)) {
            cout << "Invalid input! Please enter strictly 1 or 2: ";
            cin.clear();
            cin.ignore(256, '\n');
        }
        satellites.push_back(createSatelliteAroundEarth(i + 1, name, typeChoice));
    }
    int totalTicks, debrisPerSat;
    cout << "\nTicks to run? (recommended 100-300): "; 
    cin >> totalTicks;
    cout << "Repair duration ticks? (recommended 15-30): "; 
    cin >> REPAIR_DURATION_TICKS;
    cout << "Starting debris per satellite? (recommended 4-8): "; 
    cin >> debrisPerSat;

    ofstream logFile("blackbox.txt");
    logFile << "----- ORBITAL BLACKBOX LOG -----\n";

    ofstream teleFile("telemetry.csv");
    teleFile << "Tick,Type,ID_or_Name,X,Y,Z\n";
    
    vector<Debris> debrisList;
    int nextDebrisId = 1;
    for (int s = 0; s < satellites.size(); s++) 
    {
        for (int i = 0; i < debrisPerSat; i++) 
        {
            Debris d; 
            d.id = nextDebrisId++;
            d.pos = satellites[s]->getPos() + Vector3(rand() % 120 - 60, rand() % 120 - 60, rand() % 120 - 60);
            d.vel = satellites[s]->getVel() + Vector3((rand() % 70 - 35) / 100.0, (rand() % 70 - 35) / 100.0, (rand() % 70 - 35) / 100.0);
            debrisList.push_back(d);
        }
    }
    // OOP Unit 2: Instantiate the FlightComputer object

    FlightComputer flightComputer; 
    double simTime = 0, dt = 1.0;
    const double WATCH_DIST = 15.0;
    for (int tick = 1; tick <= totalTicks; tick++) {
        simTime += dt;
        runChaosEngine(satellites, debrisList, nextDebrisId, logFile, simTime);
        for (int i = 0; i < debrisList.size(); i++) {
            double r = std::sqrt(debrisList[i].pos.x*debrisList[i].pos.x + debrisList[i].pos.y*debrisList[i].pos.y + debrisList[i].pos.z*debrisList[i].pos.z);
            if (r > 0) {
                double gravityStrength = (6.5 * 6.5) / r;
                Vector3 gravity(-(debrisList[i].pos.x / r) * gravityStrength, -(debrisList[i].pos.y / r) * gravityStrength, -(debrisList[i].pos.z / r) * gravityStrength);
                debrisList[i].vel = debrisList[i].vel + gravity * dt;
            }
            debrisList[i].pos = debrisList[i].pos + debrisList[i].vel * dt;
        }

        // OOP Unit 2: Instantiate AVLTree object

        AVLTree tree;
        for (int i = 0; i < debrisList.size(); i++) {
            tree.insert(getSectorKey(debrisList[i].pos), debrisList[i].id);
        }
        for (int i = 0; i < satellites.size(); i++) {
            if (satellites[i]->isDisabled()) { 
                satellites[i]->tickRepair(logFile, simTime); 
                continue; 
            }
            satellites[i]->moveOneStep(dt);
            flightComputer.handleHealthDecision(satellites[i], logFile, simTime);
        }
        
        for (int i = 0; i < satellites.size(); i++) {
            teleFile << tick << ",Sat," << satellites[i]->getName() << "," << satellites[i]->getPos().x << "," << satellites[i]->getPos().y << "," << satellites[i]->getPos().z << "\n";
        }
        for (int i = 0; i < debrisList.size(); i++) {
            teleFile << tick << ",Debris," << debrisList[i].id << "," << debrisList[i].pos.x << "," << debrisList[i].pos.y << "," << debrisList[i].pos.z << "\n";
        }
        
        MinHeap heap;
            for (int i = 0; i < satellites.size(); i++) 
            {
                if (satellites[i]->isDisabled()) 
                    continue;
                Vector3 sp = satellites[i]->getPos();
                long long bx = floor(sp.x / 100.0);
                long long by = floor(sp.y / 100.0);
                long long bz = floor(sp.z / 100.0);
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) 
                    {
                        for (int dz = -1; dz <= 1; dz++) 
                        {
                            long long key = (bx + dx) * 1000000LL + (by + dy) * 1000LL + (bz + dz);
                            vector<int> ids = tree.search(key);
                            for (int k = 0; k < ids.size(); k++) 
                            {
                                Debris *d = findDebrisById(debrisList, ids[k]);
                                if (d != NULL && dist3D(sp, d->pos) < WATCH_DIST) 
                                {
                                    Threat t;
                                    t.satId = satellites[i]->getId();
                                    t.debId = d->id;
                                    t.distance = dist3D(sp, d->pos);
                                    heap.push(t);
                                }
                            }
                        }
                    }
                }
            }
            while (!heap.isEmpty()) {
            Threat th = heap.popMin();
            Satellite *sat = NULL;
            for (int i = 0; i < satellites.size(); i++) {
                if (satellites[i]->getId() == th.satId) { 
                    sat = satellites[i]; 
                    break; 
                }
            }
            Debris *d = findDebrisById(debrisList, th.debId);
            flightComputer.handleCollisionThreat(sat, d, th.distance, logFile, simTime);
        }
        if (tick % 5 == 0 || tick == totalTicks) {
            cout << "\n----- STATUS at t=" << simTime << "s -----\n";
            for (int i = 0; i < satellites.size(); i++) {
               double minDist = 9999999.0;
                string nearestName = "None";
                for (int j = 0; j < satellites.size(); j++) {
                    if (i == j) continue; 
                    double d = dist3D(satellites[i]->getPos(), satellites[j]->getPos());
                    if (d < minDist) {
                        minDist = d;
                        nearestName = satellites[j]->getName();
                    }
                }
                if (satellites.size() == 1) minDist = 0.0;
                
                cout << satellites[i]->getStatusLine(minDist, nearestName) << "\n";
            }
            cout << "\n";
        }
        usleep(60000);
    }
    logFile << "----- END OF LOG -----\n";
    logFile.close();
    teleFile.close();
    
    char searchAgain = 'y';
    while (searchAgain == 'y' || searchAgain == 'Y') {
        cout << "\n---------------------------------\n";
        cout << "Do you want to search for a satellite's final status? (y/n): ";
        cin >> searchAgain;
        if (searchAgain == 'y' || searchAgain == 'Y') {
            string searchName;
            cout << "Enter the exact name of the satellite: ";
            cin >> searchName;
            bool found = false;
            
            // linear search 
            for (int i = 0; i < satellites.size(); i++) {
                if (satellites[i]->getName() == searchName) {
                    found = true;
                    cout << "\n>>> SATELLITE FOUND <<<\n";
                    double minDist = 9999999.0;
                    string nearestName = "None";
                    for (int j = 0; j < satellites.size(); j++) {
                        if (i == j) continue;
                        double d = dist3D(satellites[i]->getPos(), satellites[j]->getPos());
                        if (d < minDist) {
                            minDist = d;
                            nearestName = satellites[j]->getName();
                        }
                    }
                    if (satellites.size() == 1) {
                        minDist = 0.0;
                    }
                    cout << satellites[i]->getStatusLine(minDist, nearestName) << "\n";
                    cout << "    -> Final Coordinates: X=" << satellites[i]->getPos().x 
                         << ", Y=" << satellites[i]->getPos().y 
                         << ", Z=" << satellites[i]->getPos().z << "\n";
                    break;
                }
            }
            if (!found) {
                cout << "\n[ERROR] Satellite '" << searchName << "' not found in Earth orbit.\n";
            }
        }
    }
    for (int i = 0; i < satellites.size(); i++) {
        delete satellites[i]; 
    }
    return 0;
}
